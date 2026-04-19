import "server-only";
import { createClient } from "@supabase/supabase-js";

export const PLANT_IMAGES_BUCKET = "plant-images";
const DEFAULT_SIGNED_URL_TTL_S = 60 * 10; // 10 minutes

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

/**
 * Return a short-lived signed download URL for a private storage object.
 * Returns null if Supabase returns an error (e.g. object missing).
 */
export async function getSignedImageUrl(
  storagePath: string,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_S,
): Promise<string | null> {
  const storage = getStorageClient();
  const { data, error } = await storage
    .from(PLANT_IMAGES_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
