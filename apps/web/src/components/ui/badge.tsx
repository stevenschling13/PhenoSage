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

const VARIANTS: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  outline: "border border-border bg-transparent text-foreground",
  success: "bg-success/15 text-success border border-success/30",
  warning: "bg-warning/15 text-warning border border-warning/30",
  destructive:
    "bg-destructive/15 text-destructive border border-destructive/30",
  info: "bg-info/15 text-info border border-info/30",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({
  variant = "default",
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
