import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getServerUser } from "@/lib/server/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getServerUser();

  if (!user) {
    redirect("/auth");
  }

  return <AppShell userEmail={user?.email ?? null}>{children}</AppShell>;
}
