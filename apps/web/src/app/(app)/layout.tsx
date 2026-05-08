import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/server/profile";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth");
  }

  return (
    <AppShell displayName={profile.displayName} userEmail={profile.email}>
      {children}
    </AppShell>
  );
}
