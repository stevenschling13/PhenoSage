import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * Supabase OAuth / magic-link / email-confirmation callback.
 * Exchanges the `code` search param for a session cookie, then
 * redirects to `next` (default `/dashboard`).
 *
 * Error cases redirect back to `/auth?error=...` so the user sees
 * a message rather than a JSON body.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";
  const error =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/auth?error=${encodeURIComponent(error)}`, url.origin),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(
        `/auth?error=${encodeURIComponent("Missing auth code")}`,
        url.origin,
      ),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(
      new URL(
        `/auth?error=${encodeURIComponent(exchangeError.message)}`,
        url.origin,
      ),
    );
  }

  const safeNext = next.startsWith("/") ? next : "/dashboard";
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
