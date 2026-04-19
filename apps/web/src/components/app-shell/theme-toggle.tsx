"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MoonIcon, SunIcon, SystemIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  if (theme === "system") {
    localStorage.removeItem("theme");
  } else {
    localStorage.setItem("theme", theme);
  }
}

function readTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const saved = localStorage.getItem("theme");
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  function pick(next: Theme): void {
    setTheme(next);
    applyTheme(next);
  }

  // Avoid hydration mismatch — render disabled placeholder on server
  if (!mounted) {
    return (
      <div
        aria-hidden="true"
        className="h-9 w-[7.25rem] rounded-md border border-input bg-muted/40"
      />
    );
  }

  const options: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
    { value: "light", label: "Light theme", Icon: SunIcon },
    { value: "system", label: "Match system theme", Icon: SystemIcon },
    { value: "dark", label: "Dark theme", Icon: MoonIcon },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex items-center rounded-md border border-input bg-background p-0.5"
    >
      {options.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <Button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            variant="ghost"
            size="sm"
            onClick={() => pick(value)}
            className={cn(
              "h-8 w-8 p-0",
              active && "bg-accent text-accent-foreground",
            )}
          >
            <Icon width={16} height={16} />
          </Button>
        );
      })}
    </div>
  );
}
