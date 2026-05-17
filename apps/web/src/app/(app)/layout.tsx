import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { countUnreadNotifications } from "@/lib/server/notifications";
import { getCurrentProfile } from "@/lib/server/profile";
import { logServerEvent } from "@/lib/server/request-id";

// Every page under (app) reads the authenticated user via getCurrentProfile.
// Mark the group dynamic so `next build` doesn't try to statically prerender
// these pages — without env vars present (e.g. on a fresh local clone or in
// some CI shapes) prerendering throws AuthConfigError and aborts the build.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Profile + unread-count are independent reads (notifications uses its
  // own SSR client and swallows its own errors), so fire them in parallel
  // — saves one Supabase round-trip on every authed page render.
  const [profileResult, unreadResult] = await Promise.allSettled([
    getCurrentProfile(),
    countUnreadNotifications(),
  ]);

  let profile: Awaited<ReturnType<typeof getCurrentProfile>> = null;
  if (profileResult.status === "fulfilled") {
    profile = profileResult.value;
  } else {
    // Re-throw Next.js control-flow signals (redirect, notFound, dynamic
    // server usage) untouched — they aren't real errors.
    if (isNextFrameworkError(profileResult.reason)) throw profileResult.reason;
    // If auth/db is unreachable we can't safely render the authenticated
    // shell. Bounce the user back to /auth where they'll see a friendly
    // status message instead of a generic Next.js error screen.
    logServerEvent("error", "app layout profile load failed", {
      error:
        profileResult.reason instanceof Error
          ? profileResult.reason.message
          : String(profileResult.reason),
    });
    redirect(
      "/auth?error=" +
        encodeURIComponent(
          "We couldn't load your account. Please sign in again.",
        ),
    );
  }

  if (!profile) {
    redirect("/auth");
  }

  // countUnreadNotifications already returns 0 on failure (see
  // notifications.ts), so a rejected settle here is the unexpected path
  // — degrade to "no badge" rather than taking the whole shell down.
  const unreadNotifications =
    unreadResult.status === "fulfilled" ? unreadResult.value : 0;

  return (
    <AppShell
      displayName={profile.displayName}
      userEmail={profile.email}
      unreadNotifications={unreadNotifications}
    >
      {children}
    </AppShell>
  );
}
