"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AssistantIcon,
  DashboardIcon,
  GrowIcon,
  LogoMark,
  PlantIcon,
  SettingsIcon,
  SparkIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
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
    label: "Assistant",
    match: ["/assistant"],
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

export function AppShell({
  children,
  displayName,
  userEmail,
}: {
  children: ReactNode;
  displayName?: string | null;
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const activeItem =
    navItems.find((item) => isActive(pathname, item.match)) ?? navItems[0]!;
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

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px]">
        <aside className="hidden w-[18rem] shrink-0 flex-col border-r border-border/80 bg-panel/88 px-5 py-6 backdrop-blur-sm lg:flex">
          <Link className="flex items-center gap-3" href="/dashboard">
            <div className="flex h-11 w-11 items-center justify-center rounded-[1.1rem] bg-accent text-accent-foreground shadow-sm">
              <LogoMark className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                PhenoSage
              </p>
              <p className="text-sm font-semibold text-foreground">
                Cultivation control
              </p>
            </div>
          </Link>

          <div className="mt-8 rounded-[1.25rem] border border-border/80 bg-surface/90 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-foreground">
                  Workspace posture
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  Private images, same-origin AI routes, and operator-scoped
                  context.
                </p>
              </div>
              <SparkIcon className="h-4 w-4 text-accent" />
            </div>
            <div className="mt-4 grid gap-2">
              <div className="metric-chip w-fit">Secure upload path</div>
              <div className="metric-chip w-fit">Persisted findings</div>
            </div>
          </div>

          <nav aria-label="Primary" className="mt-8 flex flex-1 flex-col gap-1">
            {navItems.map((item) => {
              const active = isActive(pathname, item.match);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  className={cn(
                    "group flex items-center justify-between rounded-[0.95rem] px-3 py-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent/10 text-accent-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                      : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                  )}
                  href={item.href}
                >
                  <span className="flex items-center gap-3">
                    <Icon
                      className={cn(
                        "h-5 w-5",
                        active
                          ? "text-accent"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                    />
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>

          <div className="space-y-4 rounded-[1.2rem] border border-border/80 bg-surface/92 p-4 shadow-sm">
            <div className="space-y-2">
              <Badge tone="accent" className="text-[10px]">
                Authenticated
              </Badge>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {resolvedDisplayLabel}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {userEmail ?? "Connected operator"}{" "}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Signed in to a private cultivation workspace with route-scoped
                  analysis and chat persistence.
                </p>
              </div>
            </div>
            <form action="/auth/signout" method="post">
              <button
                className={buttonStyles({
                  className: "w-full justify-center",
                  size: "sm",
                  variant: "surface",
                })}
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-border/80 bg-background/78 backdrop-blur-md">
            <div className="flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-4">
                <Link
                  className="flex items-center gap-3 lg:hidden"
                  href="/dashboard"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-[0.75rem] bg-accent text-accent-foreground shadow-sm">
                    <LogoMark className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                      PhenoSage
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {activeItem.label}
                    </p>
                  </div>
                </Link>
                <div className="hidden lg:flex lg:items-center lg:gap-3">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="metric-chip">{activeItem.label}</span>
                    <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                      Advanced operating view
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Badge className="hidden sm:inline-flex" tone="accent">
                  Private by design
                </Badge>
                <Link
                  className={buttonStyles({ size: "sm", variant: "surface" })}
                  href="/assistant"
                >
                  Ask copilot
                </Link>
              </div>
            </div>
          </header>

          <div className="flex-1 pb-24 lg:pb-8">{children}</div>

          <nav
            aria-label="Mobile primary"
            className="fixed bottom-4 left-4 right-4 z-30 rounded-[1.25rem] border border-border bg-surface/95 p-2 shadow-md backdrop-blur-md lg:hidden"
          >
            <ul className="grid grid-cols-5 gap-1">
              {navItems.map((item) => {
                const active = isActive(pathname, item.match);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-[0.75rem] px-3 py-2 text-[10px] font-semibold transition",
                        active
                          ? "bg-accent/10 text-accent-strong"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      href={item.href}
                    >
                      <Icon
                        className={cn("h-5 w-5", active ? "text-accent" : "")}
                      />
                      {item.label}
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
