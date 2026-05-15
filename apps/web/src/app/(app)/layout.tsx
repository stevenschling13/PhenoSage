import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/ui/toaster";
import { isNextFrameworkError } from "@/lib/server/auth-errors";
import { countUnreadNotifications } from "@/lib/server/notifications";
import { getCurrentProfile } from "@/lib/server/profile";
import { logServerEvent } from "@/lib/server/request-id";
import { getWorkspaceOverview } from "@/lib/server/workspace-overview";

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
    logServerEvent("error", "app layout profile load failed", {
      error: err instanceof Error ? err.message : String(err),
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

  // Fetch unread count for the header bell + sidebar badge. This call
  // already swallows errors and returns 0 on failure (see
  // notifications.ts), so a Supabase blip degrades to "no badge"
  // rather than taking the whole shell down.
  const [unreadNotifications, overview] = await Promise.all([
    countUnreadNotifications(),
    getWorkspaceOverview(),
  ]);

  // Prepare command palette data
  const commandPaletteGrows = overview.grows.map((g) => ({
    id: g.id,
    name: g.name,
  }));
  const commandPalettePlants = overview.grows
    .filter((g) => g.primaryPlantId && g.primaryPlantName)
    .map((g) => ({
      id: g.primaryPlantId!,
      name: g.primaryPlantName!,
    }));

  return (
    <AppShell
      displayName={profile.displayName}
      userEmail={profile.email}
      unreadNotifications={unreadNotifications}
    >
      {children}
      <CommandPalette grows={commandPaletteGrows} plants={commandPalettePlants} />
      <Toaster />
    </AppShell>
  );
}
