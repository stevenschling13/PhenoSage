"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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

const OPTIONS: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
  { value: "light", label: "Light theme", Icon: SunIcon },
  { value: "system", label: "Match system theme", Icon: SystemIcon },
  { value: "dark", label: "Dark theme", Icon: MoonIcon },
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    // Hydration: read the persisted theme on the client only. setState
    // inside an effect is the standard pattern for syncing client-only
    // values into React state after SSR — disable the new react-hooks rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let nextIndex: number;
    if (e.key === "ArrowRight" || e.key === "ArrowDown")
      nextIndex = (index + 1) % OPTIONS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      nextIndex = (index - 1 + OPTIONS.length) % OPTIONS.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = OPTIONS.length - 1;
    else return;

    e.preventDefault();
    const option = OPTIONS[nextIndex];
    if (!option) return;
    pick(option.value);
    buttonsRef.current[nextIndex]?.focus();
  }

  if (!mounted) {
    return (
      <div
        aria-hidden="true"
        className="h-9 w-[7.25rem] rounded-md border border-input bg-muted/40"
      />
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex items-center rounded-md border border-input bg-background p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }, index) => {
        const active = theme === value;
        return (
          <Button
            key={value}
            ref={(el) => {
              buttonsRef.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            tabIndex={active ? 0 : -1}
            variant="ghost"
            size="sm"
            onClick={() => pick(value)}
            onKeyDown={(e) => onKeyDown(e, index)}
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
