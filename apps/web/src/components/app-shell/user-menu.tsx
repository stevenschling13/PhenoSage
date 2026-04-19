"use client";

import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

function initials(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

export function UserMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full",
          "bg-accent text-xs font-semibold text-accent-foreground",
          "ring-offset-background transition hover:opacity-90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        {initials(email)}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-40 w-56 origin-top-right animate-fade-in-up rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-elevation-3"
        >
          <div className="border-b border-border px-3 py-2 text-xs">
            <p className="font-semibold text-foreground">Signed in</p>
            <p className="truncate text-muted-foreground">{email}</p>
          </div>
          <form action={signOutAction} className="p-1">
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              fullWidth
              className="justify-start"
              role="menuitem"
            >
              Sign out
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
