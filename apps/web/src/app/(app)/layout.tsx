import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { getCurrentProfile } from "@/lib/server/profile";

// Every page under (app) reads the authenticated user via getCurrentProfile.
// Mark the group dynamic so `next build` doesn't try to statically prerender
// these pages — without env vars present (e.g. on a fresh local clone or in
// some CI shapes) prerendering throws AuthConfigError and aborts the build.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  let profile: Awaited<ReturnType<typeof getCurrentProfile>> = null;
  try {
    profile = await getCurrentProfile();
  } catch (err) {
    // Re-throw Next.js control-flow signals (redirect, notFound, dynamic
    // server usage) untouched — they aren't real errors.
    if (isNextFrameworkError(err)) throw err;
    // If auth/db is unreachable we can't safely render the authenticated
    // shell. Bounce the user back to /auth where they'll see a friendly
    // status message instead of a generic Next.js error screen.
    console.error("[app-layout] failed to load profile:", err);
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

  return (
    <AppShell displayName={profile.displayName} userEmail={profile.email}>
      {children}
    </AppShell>
  );
}
