import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";

type StatTone = "default" | "accent" | "success" | "warning";

const accentStyles: Record<StatTone, string> = {
  default: "bg-surface",
  accent: "bg-gradient-to-br from-accent/5 to-surface",
  success: "bg-gradient-to-br from-success/5 to-surface",
  warning: "bg-gradient-to-br from-warning/5 to-surface",
};

export function StatCard({
  detail,
  icon,
  label,
  meta,
  tone = "default",
  value,
}: {
  detail: string;
  icon?: ReactNode;
  label: string;
  meta?: ReactNode;
  tone?: StatTone;
  value: string;
}) {
  return (
    <Card className={cn("relative overflow-hidden p-6", accentStyles[tone])}>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3 z-10">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {label}
          </p>
          <div className="space-y-1.5">
            <p className="text-3xl font-semibold tracking-[-0.04em] text-foreground">
              {value}
            </p>
            <p className="max-w-[14rem] text-sm leading-5 text-muted-foreground">
              {detail}
            </p>
          </div>
        </div>
        {icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.75rem] border border-border bg-surface text-accent shadow-sm z-10">
            {icon}
          </div>
        ) : null}
      </div>
      {meta ? <div className="pt-5 z-10 relative">{meta}</div> : null}
    </Card>
  );
}
