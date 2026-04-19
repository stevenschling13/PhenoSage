import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
        "text-foreground placeholder:text-muted-foreground",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-60",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        invalid && "border-destructive focus-visible:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
});
