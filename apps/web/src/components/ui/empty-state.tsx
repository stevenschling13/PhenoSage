import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  action,
  className,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  className?: string;
  description: string;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-4 rounded-[1rem] border border-dashed border-border bg-background-subtle/50 p-6",
        className,
      )}
    >
      {icon ? (
        <div className="flex h-10 w-10 items-center justify-center rounded-[0.75rem] border border-border bg-surface text-accent shadow-sm">
          {icon}
        </div>
      ) : null}
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
