"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client.
 *
 * Inlined here (rather than re-exported from `@/lib/supabase/browser`)
 * because Vercel's webpack environment refuses to resolve nested
 * `@/lib/supabase/*` aliases on this project regardless of cache state.
 * Other imports of `@/lib/...` resolve fine, so this targeted bypass
 * keeps the rest of the module graph clean.
 *
 * Only NEXT_PUBLIC_* vars — safe to ship to the client bundle. Never
 * import this from server code; the server path lives in
 * `@/lib/server/auth`.
 */
export function createSupabaseBrowserClient() {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createBrowserClient(url, anonKey);
}
