import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type BadgeTone = "default" | "accent" | "success" | "warning" | "danger";

const toneStyles: Record<BadgeTone, string> = {
  default: "border-border/80 bg-muted/70 text-muted-foreground",
  accent: "border-accent/15 bg-accent/10 text-accent-strong",
  success: "border-success/15 bg-success/10 text-success",
  warning: "border-warning/15 bg-warning/10 text-warning",
  danger: "border-danger/15 bg-danger/10 text-danger",
};

export function Badge({
  className,
  tone = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.02em]",
        toneStyles[tone],
        className,
      )}
      {...props}
    />
  );
}
