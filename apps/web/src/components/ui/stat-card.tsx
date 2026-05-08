import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";

type StatTone = "default" | "accent" | "success" | "warning";

const accentStyles: Record<StatTone, string> = {
  default: "bg-surface/88",
  accent:
    "bg-[linear-gradient(135deg,rgba(var(--accent),0.10),rgba(255,255,255,0.92))]",
  success:
    "bg-[linear-gradient(135deg,rgba(var(--success),0.10),rgba(255,255,255,0.92))]",
  warning:
    "bg-[linear-gradient(135deg,rgba(var(--warning),0.10),rgba(255,255,255,0.92))]",
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
    <Card
      className={cn(
        "relative overflow-hidden p-6 shadow-[0_18px_50px_rgba(17,24,17,0.05)]",
        accentStyles[tone],
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3 z-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </p>
          <div className="space-y-1.5">
            <p className="text-3xl font-semibold tracking-[-0.05em] text-foreground">
              {value}
            </p>
            <p className="max-w-[16rem] text-sm leading-6 text-muted-foreground">
              {detail}
            </p>
          </div>
        </div>
        {icon ? (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.95rem] border border-border/70 bg-surface/90 text-accent shadow-sm z-10">
            {icon}
          </div>
        ) : null}
      </div>
      {meta ? <div className="pt-5 z-10 relative">{meta}</div> : null}
    </Card>
  );
}
