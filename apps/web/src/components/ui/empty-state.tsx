import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[18px] border border-dashed border-[rgb(var(--ps-line)/0.18)] bg-[rgb(var(--ps-surface-2)/0.55)] px-6 py-14 text-center",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--ps-accent-soft))] text-[rgb(var(--ps-accent-strong))]"
        >
          {icon}
        </div>
      )}
      <h3 className="ps-display text-[18px] leading-tight">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-[13.5px] leading-[1.55] text-[rgb(var(--ps-muted))]">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
