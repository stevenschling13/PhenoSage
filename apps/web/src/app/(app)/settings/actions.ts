"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { logServerEvent } from "@/lib/server/request-id";
import { isValidTimezone } from "@/lib/server/timezone";
import type {
  UpdateDisplayNameActionResult,
  UpdateEmailPreferencesActionResult,
  UpdateTimezoneActionResult,
} from "./action-state";

// Re-export the action-result types for backwards-compatible imports.
// `export type` is erased by SWC so the runtime "use server" file
// still only exports async functions.
export type {
  UpdateDisplayNameActionResult,
  UpdateEmailPreferencesActionResult,
  UpdateTimezoneActionResult,
} from "./action-state";

// ─── Shared helpers ──────────────────────────────────────────────────
//
// Every settings action follows the same shape: authenticate, validate,
// upsert via the RLS-scoped client, return a structured `{ status }`
// result on success or failure. We deliberately do NOT use the
// service-role client (`getDbClient()`) here — the user is writing
// their OWN row, so RLS is the right enforcement boundary. Removing
// the service-role dependency also makes settings work in any
// environment that has the public Supabase env vars wired up, even if
// the service-role key is missing or rotated — which was the
// root cause of the May 15 2026 production audit's settings failures.
//
// The shared `runSettingsWrite` helper centralises the defensive
// wrapper: a top-level try/catch that re-throws Next.js framework
// control-flow signals untouched, logs everything else with structured
// fields, and converts any throw into a friendly error result. This is
// the "professional level error handling" gate — no settings action
// should ever propagate an exception to React's error boundary.

type SettingsResult<Msg extends string = string> = {
  message?: Msg | string;
  status: "error" | "idle" | "success";
};

type SettingsRunOptions = {
  actionName: string;
  defaultErrorCopy: string;
};

type SettingsWriteContext = {
  requestId: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  user: { id: string };
};

async function runSettingsWrite<R extends SettingsResult>(
  opts: SettingsRunOptions,
  body: (_ctx: SettingsWriteContext) => Promise<R>,
  unauthenticated: () => R,
): Promise<R | SettingsResult> {
  const requestId = (
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : "unknown"
  ) as string;

  try {
    const user = await getServerUser();
    if (!user) return unauthenticated();
    const supabase = await createSupabaseServerClient();
    return await body({ requestId, supabase, user });
  } catch (err) {
    if (isNextFrameworkError(err)) throw err;
    const errName = err instanceof Error ? err.name : "";
    logServerEvent("error", `${opts.actionName} top-level threw`, {
      error: err instanceof Error ? err.message : String(err),
      errorName: errName || null,
      requestId,
    });
    return {
      message: opts.defaultErrorCopy,
      status: "error",
    };
  }
}

function asTrimmedString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

// ─── Display name ────────────────────────────────────────────────────

// Postgres SQLSTATE → user-facing copy. Same mapping pattern as
// createGrowAction. Anything unmapped falls through to the generic
// default so we never leak raw provider error text to the UI.
const DISPLAY_NAME_SQLSTATE_COPY: Record<string, string> = {
  "23505": "That display name is already in use.",
  "42501":
    "You don't have permission to update this profile. Please refresh and sign in again.",
  "23503":
    "Your account couldn't be linked to a profile row. Please refresh and try again.",
  "57014": "The save took too long. Please try again in a moment.",
  "08000": "We couldn't reach the database. Please try again in a moment.",
  "08001": "We couldn't reach the database. Please try again in a moment.",
  "08006": "We couldn't reach the database. Please try again in a moment.",
};

export async function updateDisplayNameAction(
  formData: FormData,
): Promise<UpdateDisplayNameActionResult> {
  return (await runSettingsWrite<UpdateDisplayNameActionResult>(
    {
      actionName: "update display name action",
      defaultErrorCopy:
        "We couldn't save your display name right now. Please try again in a moment.",
    },
    async ({ supabase, user }) => {
      const displayName = asTrimmedString(formData.get("displayName"));
      if (displayName.length > 60) {
        return {
          message: "Keep the display name under 60 characters.",
          status: "error",
        };
      }

      const { error } = await supabase.from("profiles").upsert(
        {
          display_name: displayName || null,
          id: user.id,
        },
        { onConflict: "id" },
      );

      if (error) {
        logServerEvent("error", "update display name upsert failed", {
          error: error.message,
          code: error.code,
          userId: user.id,
        });
        const mapped = error.code
          ? DISPLAY_NAME_SQLSTATE_COPY[error.code]
          : undefined;
        return {
          message:
            mapped ??
            "We couldn't save your display name right now. Please try again in a moment.",
          status: "error",
        };
      }

      revalidatePath("/dashboard");
      revalidatePath("/settings");

      return {
        message: displayName
          ? "Display name saved."
          : "Display name cleared. Email will be used as the fallback label.",
        status: "success",
      };
    },
    () => ({
      message: "You must be signed in to update your profile.",
      status: "error",
    }),
  )) as UpdateDisplayNameActionResult;
}

// ─── Timezone preference ─────────────────────────────────────────────

// Friendly copy for the SQLSTATE codes this path can plausibly throw.
// `22023` is the migration's validation trigger telling us the IANA
// name is unrecognised — surface that in user copy. Everything else
// follows the same pattern createGrowAction uses (no raw provider
// text reaches the client).
const TIMEZONE_SQLSTATE_COPY: Record<string, string> = {
  "22023": "We don't recognise that timezone. Please pick one from the list.",
  "42501":
    "You don't have permission to update this preference. Please refresh and sign in again.",
  "23503":
    "Your account couldn't be linked to a preference row. Please refresh and try again.",
  "57014": "The save took too long. Please try again in a moment.",
  "08000": "We couldn't reach the database. Please try again in a moment.",
  "08001": "We couldn't reach the database. Please try again in a moment.",
  "08006": "We couldn't reach the database. Please try again in a moment.",
};

export async function updateTimezoneAction(
  formData: FormData,
): Promise<UpdateTimezoneActionResult> {
  return (await runSettingsWrite<UpdateTimezoneActionResult>(
    {
      actionName: "update timezone action",
      defaultErrorCopy:
        "We couldn't save your timezone right now. Please try again in a moment.",
    },
    async ({ supabase, user }) => {
      const timezone = asTrimmedString(formData.get("timezone"));
      if (!timezone) {
        return {
          message: "Pick a timezone from the list before saving.",
          status: "error",
        };
      }
      if (!isValidTimezone(timezone)) {
        return {
          message:
            "We don't recognise that timezone. Please pick one from the list.",
          status: "error",
        };
      }

      const { error } = await supabase.from("user_preferences").upsert(
        {
          user_id: user.id,
          timezone,
        },
        { onConflict: "user_id" },
      );

      if (error) {
        logServerEvent("error", "update timezone upsert failed", {
          error: error.message,
          code: error.code,
          userId: user.id,
        });
        const mapped = error.code
          ? TIMEZONE_SQLSTATE_COPY[error.code]
          : undefined;
        return {
          message:
            mapped ??
            "We couldn't save your timezone right now. Please try again in a moment.",
          status: "error",
        };
      }

      revalidatePath("/settings");

      return {
        message: `Timezone saved (${timezone}).`,
        status: "success",
      };
    },
    () => ({
      message: "You must be signed in to update your timezone.",
      status: "error",
    }),
  )) as UpdateTimezoneActionResult;
}

// ─── Email-notification preferences (Tier 2.2) ───────────────────────

const VALID_EMAIL_SEVERITY_FLOORS = new Set([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

const EMAIL_PREFS_SQLSTATE_COPY: Record<string, string> = {
  "23514":
    "We couldn't save those notification settings — please pick a valid severity.",
  "42501":
    "You don't have permission to update this preference. Please refresh and sign in again.",
  "23503":
    "Your account couldn't be linked to a preference row. Please refresh and try again.",
  "57014": "The save took too long. Please try again in a moment.",
  "08000": "We couldn't reach the database. Please try again in a moment.",
  "08001": "We couldn't reach the database. Please try again in a moment.",
  "08006": "We couldn't reach the database. Please try again in a moment.",
};

export async function updateEmailPreferencesAction(
  formData: FormData,
): Promise<UpdateEmailPreferencesActionResult> {
  return (await runSettingsWrite<UpdateEmailPreferencesActionResult>(
    {
      actionName: "update email prefs action",
      defaultErrorCopy:
        "We couldn't save your notification settings right now. Please try again in a moment.",
    },
    async ({ supabase, user }) => {
      // Checkboxes only POST when checked — read presence rather than value
      // so the absence of a key means "off". This mirrors how Next's
      // `useActionState` ferries form data from a plain HTML form.
      const dailySummary = formData.get("emailDailySummary") !== null;
      const findingAlerts = formData.get("emailFindingAlerts") !== null;
      const severityFloor = asTrimmedString(
        formData.get("emailAlertSeverityFloor"),
      );

      if (severityFloor && !VALID_EMAIL_SEVERITY_FLOORS.has(severityFloor)) {
        return {
          message:
            "Pick a valid severity floor (info, low, medium, high, critical).",
          status: "error",
        };
      }

      const { error } = await supabase.from("user_preferences").upsert(
        {
          user_id: user.id,
          email_daily_summary: dailySummary,
          email_finding_alerts: findingAlerts,
          // Default to `critical` if the form omitted the field — matches
          // DEFAULT_USER_PREFERENCES so a user who never saw the radio
          // group still ends up in a sane state.
          email_alert_severity_floor: severityFloor || "critical",
        },
        { onConflict: "user_id" },
      );

      if (error) {
        logServerEvent("error", "update email prefs upsert failed", {
          error: error.message,
          code: error.code,
          userId: user.id,
        });
        const mapped = error.code
          ? EMAIL_PREFS_SQLSTATE_COPY[error.code]
          : undefined;
        return {
          message:
            mapped ??
            "We couldn't save your notification settings right now. Please try again in a moment.",
          status: "error",
        };
      }

      revalidatePath("/settings");

      return {
        message: "Notification settings saved.",
        status: "success",
      };
    },
    () => ({
      message: "You must be signed in to update your notification settings.",
      status: "error",
    }),
  )) as UpdateEmailPreferencesActionResult;
}
