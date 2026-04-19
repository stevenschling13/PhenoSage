import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Width = "sm" | "md" | "lg" | "xl" | "full";

const WIDTHS: Record<Width, string> = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  xl: "max-w-7xl",
  full: "max-w-none",
};

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  width?: Width;
}

export function Container({
  width = "lg",
  className,
  ...props
}: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-5 sm:px-6 lg:px-8",
        WIDTHS[width],
        className,
      )}
      {...props}
    />
  );
}
