import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "link";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-elevation-1 hover:bg-primary/90 active:bg-primary/95",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70",
  outline:
    "border border-border bg-transparent text-foreground hover:bg-muted active:bg-muted/80",
  ghost: "bg-transparent text-foreground hover:bg-muted active:bg-muted/80",
  destructive:
    "bg-destructive text-destructive-foreground shadow-elevation-1 hover:bg-destructive/90",
  link: "bg-transparent text-primary underline-offset-4 hover:underline px-0 h-auto",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-6 text-base gap-2",
  icon: "h-10 w-10 p-0",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      leftIcon,
      rightIcon,
      fullWidth,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150 ease-out-expo",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          VARIANTS[variant],
          SIZES[size],
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {loading ? (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
            aria-hidden="true"
          />
        ) : (
          leftIcon
        )}
        {children}
        {!loading && rightIcon}
      </button>
    );
  },
);
