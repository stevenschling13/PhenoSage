import Link from "next/link";
import type { ReactNode } from "react";
import { LeafIcon } from "@/components/ui/icons";
import { HealthIndicator } from "./health-indicator";
import { MobileBottomNav, SidebarNav } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

interface AppShellProps {
  user: { email: string };
  children: ReactNode;
}

/**
 * Authenticated layout with persistent sidebar (md+) and bottom nav (mobile).
 * Pages render inside <main id="main-content"> for skip-link targeting.
 */
export function AppShell({ user, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex">
        {/* Sidebar — desktop */}
        <aside
          aria-label="Sidebar"
          className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col"
        >
          <Link
            href="/dashboard"
            className="flex h-16 items-center gap-2 border-b border-border px-5 font-semibold tracking-tight"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
            >
              <LeafIcon width={18} height={18} />
            </span>
            <span>PhenoSage</span>
          </Link>
          <SidebarNav className="flex-1" />
          <div className="border-t border-border p-3 text-[11px] text-muted-foreground">
            <p>v0.1 · Web-first OS</p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
            {/* Mobile brand */}
            <Link
              href="/dashboard"
              className="flex items-center gap-2 font-semibold tracking-tight md:hidden"
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
              >
                <LeafIcon width={16} height={16} />
              </span>
              <span>PhenoSage</span>
            </Link>
            <div className="flex flex-1 items-center justify-end gap-3">
              <HealthIndicator />
              <ThemeToggle />
              <UserMenu email={user.email} />
            </div>
          </header>

          <main
            id="main-content"
            tabIndex={-1}
            className="flex flex-1 flex-col pb-20 outline-none md:pb-0"
          >
            {children}
          </main>
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}
