import "server-only";

/**
 * Friendly user-facing copy for the auth surface.
 *
 * Never expose raw Supabase / fetch error text to end users — those messages
 * leak implementation detail and read as broken software ("fetch failed",
 * "TypeError", JSON blobs, etc.). Map them to short, actionable copy here.
 */

export const AUTH_GENERIC_FAILURE =
  "Something went wrong while signing you in. Please try again in a moment.";

export const AUTH_SERVICE_UNREACHABLE =
  "We couldn't reach the authentication service. Check your connection and try again in a moment.";

export const AUTH_MISCONFIGURED =
  "Sign-in is temporarily unavailable. Our team has been notified — please try again later.";

export const AUTH_INVALID_CREDENTIALS =
  "That email and password combination didn't match. Double-check and try again.";

export const AUTH_EMAIL_NOT_CONFIRMED =
  "Please confirm your email address using the link we sent before signing in.";

export const AUTH_RATE_LIMITED =
  "Too many attempts. Wait a minute and try again.";

export const AUTH_USER_EXISTS =
  "An account with that email already exists. Try signing in instead.";

export const AUTH_WEAK_PASSWORD =
  "Choose a stronger password — at least 8 characters with a mix of letters and numbers.";

/**
 * Marker error for when the auth client cannot be constructed because
 * required Supabase env vars are missing or malformed at runtime.
 */
export class AuthConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Auth is misconfigured: missing ${missing.join(", ")}`);
    this.name = "AuthConfigError";
  }
}

/**
 * Returns the names of any Supabase auth env vars that are missing or
 * obviously malformed. Empty array means the auth client can be built.
 */
export function getAuthConfigViolations(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const missing: string[] = [];
  const url = env["NEXT_PUBLIC_SUPABASE_URL"];
  const anon = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !/^https?:\/\//.test(url)) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!anon) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return missing;
}

/**
 * `redirect()` from `next/navigation` throws an opaque object whose
 * `digest` starts with "NEXT_REDIRECT". We must not swallow it.
 */
export function isNextRedirectError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/**
 * `notFound()` similarly throws an internal sentinel we must rethrow.
 */
export function isNextNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_NOT_FOUND");
}

/**
 * Catches Next.js framework signals carried on `err.digest`:
 *   - NEXT_REDIRECT
 *   - NEXT_NOT_FOUND
 *   - DYNAMIC_SERVER_USAGE (thrown when `cookies()` / `headers()` are used
 *     during static prerender so Next can re-render the route dynamically)
 *
 * Any of these MUST be re-thrown unchanged from a try/catch so Next can
 * complete its control-flow.
 */
export function isNextFrameworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;
  return (
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_NOT_FOUND") ||
    digest.startsWith("DYNAMIC_SERVER_USAGE")
  );
}

/**
 * Pattern-match a thrown or returned auth error into a single friendly
 * sentence. Prefers stable fields (`name`, `status`, `code`) over message
 * substring matching so we don't silently regress when Supabase reworks
 * its error text.
 */
export function describeAuthError(err: unknown): string {
  if (err instanceof AuthConfigError) return AUTH_MISCONFIGURED;

  if (err && typeof err === "object") {
    const e = err as {
      name?: string;
      status?: number;
      code?: string;
      message?: string;
    };

    // Supabase wraps fetch/network failures in this class.
    if (e.name === "AuthRetryableFetchError") return AUTH_SERVICE_UNREACHABLE;

    // Raw fetch failure on the server (Node undici => "fetch failed";
    // browsers => "Failed to fetch"). Either means the network call
    // never reached Supabase.
    if (
      e.name === "TypeError" &&
      typeof e.message === "string" &&
      /fetch failed|failed to fetch|networkerror/i.test(e.message)
    ) {
      return AUTH_SERVICE_UNREACHABLE;
    }

    // Supabase API errors carry stable codes / HTTP status.
    if (e.code === "invalid_credentials" || e.status === 400) {
      // 400 from /token is invalid credentials; safe friendly default.
      if (e.code === "invalid_credentials") return AUTH_INVALID_CREDENTIALS;
    }
    if (e.code === "email_not_confirmed") return AUTH_EMAIL_NOT_CONFIRMED;
    if (e.code === "user_already_exists" || e.status === 422) {
      if (e.code === "user_already_exists") return AUTH_USER_EXISTS;
    }
    if (e.code === "weak_password") return AUTH_WEAK_PASSWORD;
    if (e.status === 429) return AUTH_RATE_LIMITED;

    // Last-resort substring match on the supabase message — only for
    // patterns we recognise. Otherwise fall through to generic copy so
    // we never display raw provider text.
    if (typeof e.message === "string") {
      const m = e.message.toLowerCase();
      if (m.includes("invalid login")) return AUTH_INVALID_CREDENTIALS;
      if (m.includes("email not confirmed")) return AUTH_EMAIL_NOT_CONFIRMED;
      if (m.includes("already registered") || m.includes("already exists")) {
        return AUTH_USER_EXISTS;
      }
      if (m.includes("rate limit") || m.includes("too many"))
        return AUTH_RATE_LIMITED;
    }
  }

  return AUTH_GENERIC_FAILURE;
}
