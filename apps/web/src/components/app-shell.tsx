"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AssistantIcon,
  DashboardIcon,
  GrowIcon,
  LogoMark,
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
    match: ["/grows", "/plants"],
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
  userEmail,
}: {
  children: ReactNode;
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const activeItem =
    navItems.find((item) => isActive(pathname, item.match)) ?? navItems[0]!;

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px]">
        <aside className="hidden w-[17rem] shrink-0 flex-col border-r border-border bg-panel px-5 py-6 lg:flex">
          <Link className="flex items-center gap-3" href="/dashboard">
            <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-accent text-accent-foreground shadow-sm">
              <LogoMark className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                PhenoSage
              </p>
              <p className="text-sm font-semibold text-foreground">
                Grow Operations
              </p>
            </div>
          </Link>

          <div className="mt-8 rounded-[1rem] border border-border bg-surface p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Private workspace
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Images and analysis stay behind PhenoSage routes.
                </p>
              </div>
              <SparkIcon className="h-4 w-4 text-accent" />
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
                    "group flex items-center justify-between rounded-[0.75rem] px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent/10 text-accent-strong"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
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

          <div className="space-y-4 rounded-[1rem] border border-border bg-surface p-4 shadow-sm">
            <div className="space-y-2">
              <Badge tone="accent" className="text-[10px]">
                Authenticated
              </Badge>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {userEmail ?? "Connected operator"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Signed in to a private cultivation workspace.
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
          <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
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
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {activeItem.label}
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
            <ul className="grid grid-cols-4 gap-1">
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
