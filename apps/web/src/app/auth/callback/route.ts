import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/server/auth";
import {
  AUTH_GENERIC_FAILURE,
  AUTH_MISCONFIGURED,
  AUTH_SERVICE_UNREACHABLE,
  AuthConfigError,
  describeAuthError,
} from "@/lib/server/auth-errors";

export const dynamic = "force-dynamic";

const FALLBACK_NEXT = "/dashboard";

/**
 * Reject anything that isn't a same-origin path. `new URL("//evil.com",
 * origin)` resolves to evil.com, so we explicitly disallow protocol-
 * relative redirects too.
 */
function safeNextPath(value: string | null): string {
  if (!value) return FALLBACK_NEXT;
  if (!value.startsWith("/")) return FALLBACK_NEXT;
  if (value.startsWith("//") || value.startsWith("/\\")) return FALLBACK_NEXT;
  return value;
}

function redirectWithError(origin: string, message: string) {
  return NextResponse.redirect(
    new URL(`/auth?error=${encodeURIComponent(message)}`, origin),
  );
}

/**
 * Supabase OAuth / magic-link / email-confirmation callback.
 * Exchanges the `code` search param for a session cookie, then
 * redirects to `next` (default `/dashboard`).
 *
 * Any failure — provider error, missing code, misconfigured env,
 * unreachable Supabase — is converted into a friendly redirect back to
 * `/auth?error=...`. We never surface raw provider text here.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));
  const providerError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (providerError) {
    // Pass the provider's description through (it's user-facing copy
    // from Supabase, e.g. "Email link is invalid or has expired").
    return redirectWithError(url.origin, providerError);
  }

  if (!code) {
    return redirectWithError(
      url.origin,
      "That sign-in link is missing information. Request a new one and try again.",
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      return redirectWithError(url.origin, describeAuthError(exchangeError));
    }
  } catch (err) {
    if (err instanceof AuthConfigError) {
      console.error("[auth/callback] misconfigured:", err.missing.join(", "));
      return redirectWithError(url.origin, AUTH_MISCONFIGURED);
    }
    console.error("[auth/callback] failed:", err);
    const friendly =
      describeAuthError(err) === AUTH_GENERIC_FAILURE
        ? AUTH_SERVICE_UNREACHABLE
        : describeAuthError(err);
    return redirectWithError(url.origin, friendly);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
