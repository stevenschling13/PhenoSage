import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Returns true when both env vars required to build the service-role
 * client are present. Used by the /api/internal/diag probe and any
 * future feature that wants to fail-soft when the cron pathway isn't
 * configured, without forcing the route handler to touch
 * `process.env.SUPABASE_SERVICE_ROLE_KEY` directly (which the
 * env-contract guardrail in `scripts/check-imports.mjs` forbids).
 */
export function hasServiceRoleConfigured(): boolean {
  return Boolean(
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"],
  );
}

/**
 * Creates a Supabase client using the service role key.
 * This client bypasses RLS and must ONLY be used in server-side code.
 * NEVER expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
export function getDbClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
