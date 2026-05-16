"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { GrowMedium, GrowStage, LightType } from "@phenosage/shared";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { rateLimit } from "@/lib/server/rate-limit";
import { logServerEvent, REQUEST_ID_HEADER } from "@/lib/server/request-id";
import type { CreateGrowActionResult } from "./action-state";
import { MAX_DESCRIPTION_LENGTH, MAX_FUTURE_START_MS } from "./constants";

// Re-export the result type for backwards-compatible imports. `export
// type` is erased at compile time (SWC strips it from the JS output)
// so the runtime "use server" file still only exports async functions.
export type { CreateGrowActionResult } from "./action-state";

const validStages = new Set<GrowStage>([
  "germination",
  "seedling",
  "vegetative",
  "pre_flower",
  "flower",
  "late_flower",
  "harvest",
  "dry_cure",
]);

const validMedia = new Set<GrowMedium>([
  "soil",
  "coco",
  "hydro",
  "aero",
  "living_soil",
  "other",
]);

const validLightTypes = new Set<LightType>([
  "hps",
  "cmh",
  "led",
  "t5",
  "sun",
  "mixed",
  "other",
]);

// Per-attempt deadline on the Supabase insert. Vercel's serverless
// timeout is 60s on the hobby plan / 300s on pro, but a user staring at
// a "Saving…" spinner for more than ~8s feels broken. We surface a
// retryable error before then so the user gets fast, honest feedback.
const INSERT_TIMEOUT_MS = 8_000;

// Soft idempotency window: a single user can only fire the create
// action once per 2 s. Defends against React 18 double-invocation in
// dev, accidental double-clicks the disabled-button guard misses, and
// network-layer retries that re-POST the form. The action is NOT
// natively idempotent (no client-supplied idempotency key), so we lean
// on a tight per-user window plus the (owner_id, lower(name)) UNIQUE
// index from migration 011 as the database-level backstop.
const IDEMPOTENCY_WINDOW_MS = 2_000;
const IDEMPOTENCY_LIMIT = 1;

// Per-user abuse cap: 20 grow creations per minute is well above any
// legitimate workflow (the median grower has < 10 grows lifetime) and
// well below what a runaway script could cost us.
const ABUSE_LIMIT_WINDOW_MS = 60_000;
const ABUSE_LIMIT = 20;

function asTrimmedString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// Postgres SQLSTATE → user-facing copy. Each entry is a deliberate
// trade-off between specificity (so the user knows what to fix) and
// not leaking schema details (so we don't tell an attacker which
// table/column failed). Codes that aren't in this map fall through to
// the generic "couldn't save" copy below. Reference:
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const POSTGRES_ERROR_COPY: Record<string, string> = {
  // 23505 unique_violation — the (owner_id, lower(name)) partial UNIQUE
  // index from migration 011 fires here on duplicate names (case-
  // insensitive, ignoring archived grows).
  "23505": "A grow with that name already exists. Try a different name.",
  // 23502 not_null_violation — should be impossible because validation
  // above catches missing required fields. If we ever land here it's a
  // schema-vs-validator drift bug; the user-friendly copy is generic
  // while the structured log includes the errorCode for triage.
  "23502":
    "A required field is missing. Please fill in every required field and try again.",
  // 23514 check_violation — column-level CHECK constraint failed (e.g.
  // an enum value the client passed wasn't recognised). Validation
  // catches the documented enums; this is the contract-drift backstop.
  "23514":
    "One of the values you entered isn't valid for this field. Please pick a different option.",
  // 23503 foreign_key_violation — owner_id references auth.users(id);
  // hitting this means the user record was deleted between
  // getServerUser() and the insert. Force a fresh sign-in.
  "23503":
    "Your account couldn't be linked to the new grow. Please sign in again and retry.",
  // 42501 insufficient_privilege — RLS denied the insert. Most likely
  // cause is a session that just expired. Friendly copy nudges re-auth.
  "42501":
    "You don't have permission to create a grow right now. Please refresh and sign in again.",
  // 40001 serialization_failure — concurrent update conflict. Retryable
  // by the user (rare in practice for an INSERT, but possible if a
  // trigger touches contended state).
  "40001":
    "Another save happened at the same moment. Please try again in a moment.",
  // 40P01 deadlock_detected — same retry posture as 40001.
  "40P01": "The system was briefly busy. Please try again in a moment.",
  // 57014 query_canceled — Postgres cancelled the statement, usually
  // because of a statement_timeout. Same surface as our own AbortSignal
  // timeout below.
  "57014":
    "The save took too long. Please try again — if it keeps happening, your network may be slow.",
  // 08xxx connection_exception family — Supabase is unreachable from the
  // serverless function. Often a Supabase incident or a project paused
  // for inactivity. Always retryable.
  "08000": "We couldn't reach the database. Please try again in a moment.",
  "08001": "We couldn't reach the database. Please try again in a moment.",
  "08006": "We couldn't reach the database. Please try again in a moment.",
};

// Default copy when the failure isn't a Postgres error or has an
// unmapped SQLSTATE. Kept short, actionable, and free of provider
// details — matches the pattern in describeAuthError().
const DEFAULT_INSERT_FAILURE_COPY =
  "We couldn't save the grow right now. Please try again in a moment.";

function describePostgresError(code: string | null | undefined): string {
  if (typeof code === "string" && POSTGRES_ERROR_COPY[code]) {
    return POSTGRES_ERROR_COPY[code]!;
  }
  return DEFAULT_INSERT_FAILURE_COPY;
}

// Best-effort request-id resolver. Server actions don't expose the
// raw Request object, but Next 15 lets us peek at incoming headers.
// On any failure (e.g. inside a unit test that doesn't mock headers())
// we degrade gracefully so error-handling itself never throws.
async function resolveRequestId(): Promise<string> {
  try {
    const h = await headers();
    const incoming = h.get(REQUEST_ID_HEADER)?.trim();
    if (incoming) return incoming;
  } catch {
    // Fall through — headers() can throw outside a request scope (tests,
    // background contexts). The fallback id keeps logs structured.
  }
  try {
    return crypto.randomUUID();
  } catch {
    return "unknown";
  }
}

export async function createGrowAction(
  formData: FormData,
): Promise<CreateGrowActionResult> {
  // Top-level try/catch is the "professional error handling" gate:
  // every code path inside this function is allowed to throw, and the
  // catch converts the throw into a structured `{ status: "error" }`
  // result. NEXT_REDIRECT / NEXT_NOT_FOUND framework signals are
  // re-thrown so Next can complete its control-flow. Without this
  // wrapper, a thrown `getServerUser()` (AuthConfigError, fetch-failed,
  // etc.) or `rateLimit()` (Redis outage on a misconfigured backend)
  // would bubble to React's error boundary as a "Server Components
  // render" error and strand the user on the workspace error page.
  let requestId = "unknown";
  let userId: string | null = null;
  try {
    requestId = await resolveRequestId();

    const user = await getServerUser();
    if (!user) {
      return {
        message: "You must be signed in to create a grow.",
        status: "error",
      };
    }
    userId = user.id;

    // ─── Soft idempotency + abuse caps ──────────────────────────────────
    // Order matters: the tight 2 s window catches double-submits before
    // we run any validation, so a user spamming the button doesn't get
    // 5× field-error renders. The 60 s cap is the abuse backstop.
    const idempotency = await rateLimit({
      key: `create-grow:idem:u:${user.id}`,
      limit: IDEMPOTENCY_LIMIT,
      windowMs: IDEMPOTENCY_WINDOW_MS,
    });
    if (!idempotency.ok) {
      logServerEvent("warn", "create grow rate-limited (idempotency window)", {
        requestId,
        resetAt: idempotency.resetAt,
        userId: user.id,
      });
      return {
        message:
          "We're already saving your last submission — give it a moment, then try again if it didn't go through.",
        status: "error",
      };
    }

    const abuse = await rateLimit({
      key: `create-grow:abuse:u:${user.id}`,
      limit: ABUSE_LIMIT,
      windowMs: ABUSE_LIMIT_WINDOW_MS,
    });
    if (!abuse.ok) {
      logServerEvent("warn", "create grow rate-limited (abuse cap)", {
        requestId,
        resetAt: abuse.resetAt,
        userId: user.id,
      });
      return {
        message:
          "You've created a lot of grows in the last minute. Please slow down and try again shortly.",
        status: "error",
      };
    }

    const name = asTrimmedString(formData.get("name"));
    const description = asTrimmedString(formData.get("description"));
    const stage = asTrimmedString(formData.get("stage"));
    const medium = asTrimmedString(formData.get("medium"));
    const lightType = asTrimmedString(formData.get("lightType"));
    const startDate = asTrimmedString(formData.get("startDate"));
    const targetHarvestDate = asTrimmedString(
      formData.get("targetHarvestDate"),
    );

    const fieldErrors: CreateGrowActionResult["fieldErrors"] = {};

    if (!name) {
      fieldErrors.name = "Name is required.";
    } else if (name.length > 120) {
      fieldErrors.name = "Keep the grow name under 120 characters.";
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      fieldErrors.description = `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`;
    }

    if (!validStages.has(stage as GrowStage)) {
      fieldErrors.stage = "Choose a valid grow stage.";
    }

    if (!validMedia.has(medium as GrowMedium)) {
      fieldErrors.medium = "Choose a valid medium.";
    }

    if (!validLightTypes.has(lightType as LightType)) {
      fieldErrors.lightType = "Choose a valid light type.";
    }

    if (!startDate) {
      fieldErrors.startDate = "Start date is required.";
    } else if (!isIsoDate(startDate)) {
      fieldErrors.startDate = "Use a valid start date.";
    } else if (Date.parse(startDate) > Date.now() + MAX_FUTURE_START_MS) {
      fieldErrors.startDate =
        "Start date can't be more than a day in the future.";
    }

    if (targetHarvestDate) {
      if (!isIsoDate(targetHarvestDate)) {
        fieldErrors.targetHarvestDate = "Use a valid target harvest date.";
      } else if (
        startDate &&
        isIsoDate(startDate) &&
        targetHarvestDate < startDate
      ) {
        fieldErrors.targetHarvestDate =
          "Target harvest date must be on or after the start date.";
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        fieldErrors,
        message: "Fix the highlighted fields and try again.",
        status: "error",
      };
    }

    let newGrowId: string | null = null;
    try {
      const supabase = await createSupabaseServerClient();
      // Per-attempt deadline. AbortSignal.timeout fires at INSERT_TIMEOUT_MS
      // and supabase-js v2 forwards it to its underlying fetch via
      // .abortSignal(). On fire we treat it as a retryable timeout — the
      // INSERT either landed (and we never see the row) or it didn't; the
      // (owner_id, lower(name)) UNIQUE index converts a phantom-success
      // double into a friendly 23505 on retry.
      const timeoutSignal = AbortSignal.timeout(INSERT_TIMEOUT_MS);
      const { data, error } = await supabase
        .from("grows")
        .insert({
          description: description || null,
          light_type: lightType as LightType,
          medium: medium as GrowMedium,
          name,
          owner_id: user.id,
          stage: stage as GrowStage,
          start_date: startDate,
          target_harvest_date: targetHarvestDate || null,
        })
        .select("id")
        .abortSignal(timeoutSignal)
        .single();

      if (error || !data) {
        logServerEvent("error", "create grow insert failed", {
          error: error?.message ?? "no row returned",
          errorCode: error?.code ?? null,
          hasDescription: description.length > 0,
          hasTargetHarvestDate: targetHarvestDate.length > 0,
          lightType,
          medium,
          nameLength: name.length,
          requestId,
          stage,
          userId: user.id,
        });
        return {
          message: describePostgresError(error?.code ?? null),
          status: "error",
        };
      }

      newGrowId = data.id;

      revalidatePath("/dashboard");
      revalidatePath("/grows");
      revalidatePath("/plants");
    } catch (err) {
      // Re-throw Next framework control-flow signals untouched.
      if (isNextFrameworkError(err)) throw err;
      // Differentiate the timeout/abort path so the user gets actionable
      // copy ("took too long") instead of a generic "something went wrong".
      // AbortSignal.timeout fires a DOMException with name "TimeoutError";
      // a caller-cancelled abort fires "AbortError". Either way the
      // database state is uncertain — see the UNIQUE-index backstop note
      // above the insert.
      const errName = err instanceof Error ? err.name : "";
      const isTimeout = errName === "TimeoutError" || errName === "AbortError";
      logServerEvent("error", "create grow action threw", {
        error: err instanceof Error ? err.message : String(err),
        errorName: errName || null,
        hasDescription: description.length > 0,
        hasTargetHarvestDate: targetHarvestDate.length > 0,
        isTimeout,
        lightType,
        medium,
        nameLength: name.length,
        requestId,
        stage,
        userId: user.id,
      });
      return {
        message: isTimeout
          ? "The save took longer than expected. Please try again — your input is preserved."
          : "We couldn't save the grow right now. Please try again in a moment — if it keeps failing, your sign-in may have expired.",
        status: "error",
      };
    }

    // Return a redirectTo instead of calling redirect() here. When this server
    // action is invoked from a client-side `await` inside startTransition, a
    // NEXT_REDIRECT throw cannot be intercepted by the framework and surfaces
    // as an error boundary hit. Letting the client perform router.push avoids
    // that entire failure mode.
    //
    // Land on the grow detail page so the user immediately sees the grow
    // they just created with plant intake one click away. The form's
    // useActionWithRecovery falls back to /grows if /grows/[id] is
    // unreachable for any reason, so users are never stranded.
    const redirectTo = newGrowId
      ? `/grows/${encodeURIComponent(newGrowId)}?just_created=1`
      : "/grows";
    return {
      message: "Grow created.",
      redirectTo,
      status: "success",
    };
  } catch (err) {
    // ─── Outer defensive guard ──────────────────────────────────────────
    // Anything that escapes the inner blocks lands here: most likely
    // `getServerUser()` or `rateLimit()` throwing because of misconfigured
    // env (AuthConfigError) or a Supabase auth/Redis outage. We log loudly
    // and return a structured error so the form re-renders inline instead
    // of breaking the workspace error boundary. Next.js control-flow
    // signals are re-thrown so redirects / not-found still work.
    if (isNextFrameworkError(err)) throw err;
    const errName = err instanceof Error ? err.name : "";
    const errMessage = err instanceof Error ? err.message : String(err);
    logServerEvent("error", "create grow action top-level threw", {
      error: errMessage,
      errorName: errName || null,
      requestId,
      userId,
    });
    // Differentiate the misconfiguration path so on-call sees the right
    // signal in user reports. AuthConfigError carries an explicit name.
    const isAuthConfig = errName === "AuthConfigError";
    return {
      message: isAuthConfig
        ? "Grow creation is temporarily unavailable. Our team has been notified — please try again in a few minutes."
        : "We couldn't save the grow right now. Please refresh the page, sign in again if prompted, and try once more.",
      status: "error",
    };
  }
}
