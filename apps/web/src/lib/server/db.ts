import "server-only";
import { createClient } from "@supabase/supabase-js";

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
