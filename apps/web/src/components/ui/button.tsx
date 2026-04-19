import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "surface"
  | "destructive";

type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-accent text-accent-foreground hover:bg-accent-strong",
  secondary:
    "border-border-strong/70 bg-background-subtle text-foreground hover:bg-muted",
  ghost:
    "border-transparent bg-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
  surface:
    "border-border/80 bg-surface text-foreground hover:bg-surface-elevated",
  destructive:
    "border-transparent bg-danger text-danger-foreground hover:bg-danger/90",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-[15px]",
  icon: "h-10 w-10",
};

export function buttonStyles({
  className,
  fullWidth,
  size = "md",
  variant = "primary",
}: {
  className?: string | undefined;
  fullWidth?: boolean | undefined;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full border font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-55",
    variantStyles[variant],
    sizeStyles[size],
    fullWidth && "w-full",
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  fullWidth?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function Button({
  className,
  fullWidth,
  size,
  type = "button",
  variant,
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonStyles({ className, fullWidth, size, variant })}
      type={type}
      {...props}
    />
  );
}
