import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/server/profile";

export default async function AppLayout({ children }: { children: ReactNode }) {
  let profile: Awaited<ReturnType<typeof getCurrentProfile>> = null;
  try {
    profile = await getCurrentProfile();
  } catch (err) {
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
