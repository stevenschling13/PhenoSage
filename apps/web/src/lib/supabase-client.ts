"use client";

/**
 * Cache-bust re-export of the browser Supabase client.
 *
 * Vercel's persistent webpack build cache predates the `lib/supabase/`
 * directory and refuses to resolve `@/lib/supabase` or `@/lib/supabase/browser`
 * even after the files exist. Importing through this top-level path forces
 * Webpack to do a fresh module-resolution pass.
 */
export { createSupabaseBrowserClient } from "@/lib/supabase/browser";
