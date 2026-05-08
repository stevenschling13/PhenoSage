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
    <div className="min-h-screen bg-[rgb(var(--ps-canvas))] text-[rgb(var(--ps-ink))]">
      <div className="flex">
        {/* Sidebar — desktop */}
        <aside
          aria-label="Sidebar"
          className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface)/0.6)] md:flex"
        >
          <Link
            href="/dashboard"
            className="flex h-16 items-center gap-2.5 border-b border-[rgb(var(--ps-line)/var(--ps-line-strength))] px-5"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--ps-ink))] text-[rgb(var(--ps-canvas))]"
            >
              <LeafIcon width={16} height={16} />
            </span>
            <span className="ps-display text-[18px] leading-none">
              PhenoSage
            </span>
          </Link>
          <SidebarNav className="flex-1" />
          <div className="border-t border-[rgb(var(--ps-line)/var(--ps-line-strength))] p-3">
            <p className="ps-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--ps-subtle))]">
              v0.1 · operator preview
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-canvas)/0.85)] px-4 backdrop-blur md:px-6">
            {/* Mobile brand */}
            <Link
              href="/dashboard"
              className="flex items-center gap-2 md:hidden"
            >
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--ps-ink))] text-[rgb(var(--ps-canvas))]"
              >
                <LeafIcon width={14} height={14} />
              </span>
              <span className="ps-display text-[15px] leading-none">
                PhenoSage
              </span>
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
