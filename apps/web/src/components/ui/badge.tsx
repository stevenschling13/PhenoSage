import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive"
  | "info";

type Tone = "default" | "accent" | "success" | "warning" | "danger" | "info";

const VARIANTS: Record<Variant, string> = {
  default: "bg-[rgb(var(--ps-ink))] text-[rgb(var(--ps-canvas))]",
  secondary: "bg-[rgb(var(--ps-ink)/0.05)] text-[rgb(var(--ps-ink-2))]",
  outline:
    "border border-[rgb(var(--ps-line)/var(--ps-line-strong-strength))] bg-transparent text-[rgb(var(--ps-ink-2))]",
  success:
    "bg-[rgb(var(--ps-ok)/0.12)] text-[rgb(var(--ps-ok))] border border-[rgb(var(--ps-ok)/0.32)]",
  warning:
    "bg-[rgb(var(--ps-warn)/0.16)] text-[rgb(var(--ps-warn))] border border-[rgb(var(--ps-warn)/0.36)]",
  destructive:
    "bg-[rgb(var(--ps-crit)/0.16)] text-[rgb(var(--ps-crit))] border border-[rgb(var(--ps-crit)/0.36)]",
  info: "bg-[rgb(var(--ps-accent-soft))] text-[rgb(var(--ps-accent-strong))] border border-[rgb(var(--ps-accent)/0.32)]",
};

const TONE_TO_VARIANT: Record<Tone, Variant> = {
  default: "secondary",
  accent: "info",
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  tone?: Tone;
}

export function Badge({ variant, tone, className, ...props }: BadgeProps) {
  const resolved: Variant =
    variant ?? (tone ? TONE_TO_VARIANT[tone] : "default");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.08em] leading-none whitespace-nowrap",
        VARIANTS[resolved],
        className,
      )}
      {...props}
    />
  );
}
