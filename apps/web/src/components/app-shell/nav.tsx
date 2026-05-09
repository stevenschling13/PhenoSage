"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  LeafIcon,
  ChatIcon,
  SettingsIcon,
  ImageIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export interface NavItem {
  href: string;
  label: string;
  Icon: typeof HomeIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", Icon: HomeIcon },
  { href: "/grows", label: "Grows", Icon: LeafIcon },
  { href: "/plants", label: "Plants", Icon: ImageIcon },
  { href: "/assistant", label: "Assistant", Icon: ChatIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className={cn("flex flex-col gap-0.5 px-3 py-4", className)}
    >
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[14px] font-medium transition-colors duration-150",
              active
                ? "bg-[rgb(var(--ps-ink))] text-[rgb(var(--ps-canvas))]"
                : "text-[rgb(var(--ps-ink-2))] hover:bg-[rgb(var(--ps-ink)/0.06)] hover:text-[rgb(var(--ps-ink))]",
            )}
          >
            <Icon
              width={17}
              height={17}
              className={cn(
                "transition-colors",
                active
                  ? "text-[rgb(var(--ps-canvas))]"
                  : "text-[rgb(var(--ps-muted))] group-hover:text-[rgb(var(--ps-ink))]",
              )}
            />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-3 left-3 right-3 z-30 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-5 gap-1 rounded-full border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface))] p-1.5 shadow-soft">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                className={cn(
                  "flex h-10 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[10px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ps-accent))]",
                  active
                    ? "bg-[rgb(var(--ps-ink))] text-[rgb(var(--ps-canvas))]"
                    : "text-[rgb(var(--ps-muted))] hover:text-[rgb(var(--ps-ink))]",
                )}
              >
                <Icon width={18} height={18} />
                <span className="leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
