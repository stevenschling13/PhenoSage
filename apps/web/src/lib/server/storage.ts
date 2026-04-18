import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase Storage client using the service role key.
 * Used server-side to generate signed upload/download URLs.
 * NEVER expose the service role key to the browser.
 */
export function getStorageClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabase.storage;
}
