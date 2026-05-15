"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/auth/actions";
import {
  AssistantIcon,
  BellIcon,
  DashboardIcon,
  GrowIcon,
  LogoMark,
  PlantIcon,
  SettingsIcon,
} from "@/components/icons";
import { buttonStyles } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const navItems = [
  {
    href: "/dashboard",
    icon: DashboardIcon,
    label: "Dashboard",
    match: ["/dashboard"],
  },
  {
    href: "/grows",
    icon: GrowIcon,
    label: "Grows",
    match: ["/grows"],
  },
  {
    href: "/plants",
    icon: PlantIcon,
    label: "Plants",
    match: ["/plants"],
  },
  {
    href: "/assistant",
    icon: AssistantIcon,
    label: "Copilot",
    match: ["/assistant"],
  },
  {
    href: "/notifications",
    icon: BellIcon,
    label: "Inbox",
    match: ["/notifications"],
  },
  {
    href: "/settings",
    icon: SettingsIcon,
    label: "Settings",
    match: ["/settings"],
  },
];

function isActive(pathname: string, matchers: string[]) {
  return matchers.some(
    (entry) => pathname === entry || pathname.startsWith(`${entry}/`),
  );
}

// Render the unread badge as a small pill. Capped at "9+" so a runaway
// notification feed can't blow out the layout.
function formatBadge(count: number): string {
  if (count <= 0) return "";
  if (count > 9) return "9+";
  return String(count);
}

export function AppShell({
  children,
  displayName,
  userEmail,
  unreadNotifications = 0,
}: {
  children: ReactNode;
  displayName?: string | null;
  userEmail?: string | null;
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const operatorLabel =
    displayName?.trim() ||
    userEmail
      ?.split("@")[0]
      ?.replace(/[._-]+/g, " ")
      .trim() ||
    "operator";
  const resolvedDisplayLabel = operatorLabel.replace(/\b\w/g, (character) =>
    character.toUpperCase(),
  );
  const initials = resolvedDisplayLabel
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const badge = formatBadge(unreadNotifications);

  return (
    <div className="min-h-screen bg-[rgb(var(--ps-canvas))] text-[rgb(var(--ps-ink))]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px]">
        {/* ── Sidebar — desktop ─────────────────────────── */}
        <aside
          aria-label="Sidebar"
          className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col border-r border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface)/0.6)] px-5 py-6 lg:flex"
        >
          <Link
            className="flex items-center gap-2.5"
            href="/dashboard"
            aria-label="PhenoSage home"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--ps-ink))] text-[rgb(var(--ps-canvas))]"
            >
              <LogoMark className="h-4 w-4" />
            </span>
            <span className="ps-display text-[20px] leading-none">
              PhenoSage
            </span>
          </Link>

          <p className="ps-eyebrow mt-8">Workspace</p>
          <nav
            aria-label="Primary"
            className="mt-3 flex flex-1 flex-col gap-0.5"
          >
            {navItems.map((item) => {
              const active = isActive(pathname, item.match);
              const Icon = item.icon;
              const showBadge = item.href === "/notifications" && badge !== "";
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[14px] font-medium transition-colors",
                    active
                      ? "bg-[rgb(var(--ps-ink))] text-[rgb(var(--ps-canvas))]"
                      : "text-[rgb(var(--ps-ink-2))] hover:bg-[rgb(var(--ps-ink)/0.06)] hover:text-[rgb(var(--ps-ink))]",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-[17px] w-[17px] transition-colors",
                      active
                        ? "text-[rgb(var(--ps-canvas))]"
                        : "text-[rgb(var(--ps-muted))] group-hover:text-[rgb(var(--ps-ink))]",
                    )}
                  />
                  <span className="flex-1">{item.label}</span>
                  {showBadge ? (
                    <span
                      aria-label={`${unreadNotifications} unread notifications`}
                      className={cn(
                        "ps-mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium leading-none",
                        active
                          ? "bg-[rgb(var(--ps-canvas))] text-[rgb(var(--ps-ink))]"
                          : "bg-[rgb(var(--ps-accent))] text-white",
                      )}
                    >
                      {badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="mt-6 rounded-[18px] border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface))] p-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgb(var(--ps-accent-soft))] text-[rgb(var(--ps-accent-strong))] ps-mono text-[12px] font-medium"
              >
                {initials || "OP"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium leading-tight">
                  {resolvedDisplayLabel}
                </p>
                <p className="ps-mono mt-0.5 truncate text-[10.5px] uppercase tracking-[0.08em] text-[rgb(var(--ps-muted))]">
                  {userEmail ?? "signed in"}
                </p>
              </div>
            </div>
            <form action={signOutAction} className="mt-3">
              <button
                className={buttonStyles({
                  className: "w-full justify-center",
                  size: "sm",
                  variant: "outline",
                })}
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>

          <p className="ps-mono mt-4 text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--ps-subtle))]">
            v0.1 · operator preview
          </p>
        </aside>

        {/* ── Main column ───────────────────────────────── */}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-canvas)/0.85)] backdrop-blur-md">
            <div className="flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
              {/* Mobile brand */}
              <Link
                className="flex items-center gap-2 lg:hidden"
                href="/dashboard"
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--ps-ink))] text-[rgb(var(--ps-canvas))]"
                >
                  <LogoMark className="h-3.5 w-3.5" />
                </span>
                <span className="ps-display text-[16px] leading-none">
                  PhenoSage
                </span>
              </Link>

              <div className="hidden items-center gap-3 lg:flex">
                <span className="ps-mono text-[11px] uppercase tracking-[0.14em] text-[rgb(var(--ps-muted))]">
                  Operator workspace
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  aria-label={
                    badge
                      ? `Notifications, ${unreadNotifications} unread`
                      : "Notifications"
                  }
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface))] text-[rgb(var(--ps-ink-2))] transition-colors hover:text-[rgb(var(--ps-ink))]"
                  href="/notifications"
                >
                  <BellIcon className="h-4 w-4" />
                  {badge ? (
                    <span
                      aria-hidden="true"
                      className="ps-mono absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[rgb(var(--ps-accent))] px-1.5 text-[10px] font-medium leading-none text-white"
                    >
                      {badge}
                    </span>
                  ) : null}
                </Link>
                <Link
                  className={buttonStyles({ size: "sm", variant: "outline" })}
                  href="/assistant"
                >
                  Ask copilot
                </Link>
              </div>
            </div>
          </header>

          <div className="flex-1 pb-28 lg:pb-12">{children}</div>

          {/* ── Mobile bottom nav (floating pill) ──────── */}
          <nav
            aria-label="Mobile primary"
            className="fixed bottom-3 left-3 right-3 z-30 lg:hidden"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <ul className="grid grid-cols-6 gap-1 rounded-full border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface))] p-1.5 shadow-soft">
              {navItems.map((item) => {
                const active = isActive(pathname, item.match);
                const Icon = item.icon;
                const showBadge =
                  item.href === "/notifications" && badge !== "";
                return (
                  <li key={item.href}>
                    <Link
                      aria-current={active ? "page" : undefined}
                      aria-label={
                        showBadge
                          ? `${item.label}, ${unreadNotifications} unread`
                          : item.label
                      }
                      className={cn(
                        "relative flex h-10 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[10px] font-medium transition-colors",
                        active
                          ? "bg-[rgb(var(--ps-ink))] text-[rgb(var(--ps-canvas))]"
                          : "text-[rgb(var(--ps-muted))] hover:text-[rgb(var(--ps-ink))]",
                      )}
                      href={item.href}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                      <span className="leading-none">{item.label}</span>
                      {showBadge ? (
                        <span
                          aria-hidden="true"
                          className="absolute right-1 top-0.5 inline-block h-1.5 w-1.5 rounded-full bg-[rgb(var(--ps-accent))]"
                        />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </div>
    </div>
  );
}
