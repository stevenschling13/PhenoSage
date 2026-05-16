import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/server/auth";
import {
  AuthConfigError,
  getAuthConfigViolations,
} from "@/lib/server/auth-errors";
import { hasServiceRoleConfigured } from "@/lib/server/db";
import { logServerEvent } from "@/lib/server/request-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/internal/diag
//
// Operator-only diagnostic endpoint. Verifies the moving parts that
// make grow creation and settings writes work in production. The
// May 15 2026 audit surfaced grow-creation + settings save failures
// that were impossible to triage from outside; this endpoint gives
// on-call a single curl that reports which dependency is failing.
//
// Auth: `Authorization: Bearer ${CRON_SECRET}` (re-uses the existing
// cron-route secret so we don't introduce a new env contract). When
// `CRON_SECRET` is unset the endpoint refuses every request — never
// expose env-presence info to anonymous callers.
//
// Output (200 OK with `ok` boolean for each check):
//   {
//     ok: boolean,
//     timestamp: string,
//     checks: {
//       authEnv:           { ok, missing? },
//       serviceRoleEnv:    { ok, missing? },
//       supabaseConnect:   { ok, error? },
//       authenticated:     { ok, note? },
//       writePathReady:    { ok, note? },
//     }
//   }
//
// The endpoint NEVER writes to the database — it's a read-only
// probe. The "writePathReady" check confirms that the row-level
// security session can see at least one of its own rows (proof that
// auth cookies + RLS are wired up). If a deployer wants to run a
// destructive smoke test, do it with a real authenticated browser
// session, not this endpoint.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env["CRON_SECRET"];
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks: Record<string, { ok: boolean; [k: string]: unknown }> = {};

  // 1. Public Supabase env vars (used by the RLS-scoped client + the
  //    browser). Missing or malformed values block every authenticated
  //    write path.
  const missing = getAuthConfigViolations();
  checks["authEnv"] =
    missing.length === 0 ? { ok: true } : { ok: false, missing };

  // 2. Service-role env. Required only for server-only paths (cron,
  //    daily summary, finding-alert dispatch). User-write paths
  //    (createGrow, settings) deliberately do NOT depend on this.
  //    The lookup goes through the helper module so the env-contract
  //    guardrail (scripts/check-imports.mjs) stays green — route
  //    handlers must not touch the service-role key directly.
  const hasServiceRole = hasServiceRoleConfigured();
  checks["serviceRoleEnv"] = {
    ok: hasServiceRole,
    note: hasServiceRole
      ? undefined
      : "missing SUPABASE_SERVICE_ROLE_KEY — cron + alert flows are offline",
  };

  // 3. Supabase reachability through the RLS-scoped client. This is the
  //    exact path createGrow + settings use, so a 5xx here matches the
  //    real failure surface.
  let supabaseOk = false;
  let supabaseError: string | undefined;
  let authedUserId: string | null = null;
  if (checks["authEnv"]?.ok) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        supabaseError = error.message;
      } else {
        supabaseOk = true;
        authedUserId = data.user?.id ?? null;
      }
    } catch (err) {
      if (err instanceof AuthConfigError) {
        supabaseError = `AuthConfigError: ${err.missing.join(", ")}`;
      } else {
        supabaseError = err instanceof Error ? err.message : String(err);
      }
      logServerEvent("error", "diag: supabase connect failed", {
        error: supabaseError,
      });
    }
  }
  checks["supabaseConnect"] = supabaseOk
    ? { ok: true }
    : { ok: false, error: supabaseError ?? "skipped (authEnv invalid)" };

  // 4. Authenticated-session probe. The operator's curl call rarely
  //    carries a Supabase session cookie, so `authed=false` is the
  //    expected default and doesn't fail the overall probe — it just
  //    reports that the caller can't exercise the write path here.
  checks["authenticated"] = authedUserId
    ? { ok: true, userId: authedUserId }
    : { ok: false, note: "no Supabase session on the diag call (expected)" };

  // 5. RLS write-path readiness. If we have an authed user we can
  //    confirm RLS reads work by counting their own grows. This is
  //    intentionally cheap — `head: true` returns 0 rows, just the
  //    count, so we don't pull data into the response.
  let writePathOk = false;
  let writePathNote: string | undefined;
  if (supabaseOk && authedUserId) {
    try {
      const supabase = await createSupabaseServerClient();
      const { error: rlsError } = await supabase
        .from("grows")
        .select("id", { count: "exact", head: true })
        .limit(1);
      if (rlsError) {
        writePathNote = `grows read failed: ${rlsError.code ?? "no-code"}`;
      } else {
        writePathOk = true;
      }
    } catch (err) {
      writePathNote = err instanceof Error ? err.message : String(err);
    }
  } else {
    writePathNote = "skipped (no auth session)";
  }
  checks["writePathReady"] = writePathOk
    ? { ok: true }
    : { ok: false, note: writePathNote };

  // Overall OK requires the deploy-critical checks; the user-session-
  // dependent ones don't sink the probe when invoked from curl.
  const ok =
    Boolean(checks["authEnv"]?.ok) && Boolean(checks["supabaseConnect"]?.ok);

  return NextResponse.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: ok ? 200 : 503 },
  );
}
