import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AuthConfigError, getAuthConfigViolations } from "./auth-errors";

/**
 * Creates a Supabase client scoped to the current request's cookies.
 * Use this to access the authenticated user's session.
 * Never import this in client components.
 *
 * Throws {@link AuthConfigError} when required public env vars are
 * missing or malformed, so callers can render a friendly
 * "auth misconfigured" state instead of leaking a downstream
 * "fetch failed" / TypeError to the user.
 */
export async function createSupabaseServerClient() {
  const missing = getAuthConfigViolations();
  if (missing.length > 0) throw new AuthConfigError(missing);

  const cookieStore = await cookies();

  return createServerClient(
    process.env["NEXT_PUBLIC_SUPABASE_URL"]!,
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll is called from Server Components; cookies() is read-only there.
            // This is safe to ignore — middleware handles cookie refreshes.
          }
        },
      },
    },
  );
}

/**
 * Returns the current authenticated session, or null if unauthenticated.
 */
export async function getServerSession() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/**
 * Returns the current user, or null if unauthenticated.
 */
export async function getServerUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Like {@link getServerUser} but never throws. Returns `null` for both
 * unauthenticated visitors *and* failed-to-reach-Supabase situations.
 *
 * Use from server components / route handlers that must keep rendering
 * even when the auth service is misconfigured or unreachable — for
 * example the `/auth` page itself, where throwing would replace the
 * sign-in form with a generic Next.js error screen.
 */
export async function tryGetServerUser() {
  try {
    return await getServerUser();
  } catch {
    return null;
  }
}
