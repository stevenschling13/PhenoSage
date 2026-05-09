import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type CardVariant = "default" | "surface" | "accent";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const VARIANTS: Record<CardVariant, string> = {
  default: "bg-[rgb(var(--ps-surface))] text-[rgb(var(--ps-ink))] shadow-soft",
  surface: "bg-[rgb(var(--ps-surface-2)/0.7)] text-[rgb(var(--ps-ink))]",
  accent: "bg-[rgb(var(--ps-accent-soft))] text-[rgb(var(--ps-accent-strong))]",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant = "default", ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "ps-rise rounded-[18px] border border-[rgb(var(--ps-line)/var(--ps-line-strength))]",
        VARIANTS[variant],
        "transition-shadow duration-200",
        className,
      )}
      {...props}
    />
  );
});

export const CardHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function CardHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-1.5 p-6 pb-4", className)}
      {...props}
    />
  );
});

export const CardTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn("ps-display text-[19px] leading-tight", className)}
      {...props}
    />
  );
});

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      className={cn(
        "text-[13.5px] leading-6 text-[rgb(var(--ps-muted))]",
        className,
      )}
      {...props}
    />
  );
});

export const CardContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function CardContent({ className, ...props }, ref) {
  return <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />;
});

export const CardFooter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function CardFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("flex items-center p-6 pt-0", className)}
      {...props}
    />
  );
});
