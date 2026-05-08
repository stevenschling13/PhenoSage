import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";

type StatTone = "default" | "accent" | "success" | "warning";

const accentBars: Record<StatTone, string> = {
  default: "bg-[rgb(var(--ps-line)/0.15)]",
  accent: "bg-[rgb(var(--ps-accent))]",
  success: "bg-[rgb(var(--ps-ok))]",
  warning: "bg-[rgb(var(--ps-warn))]",
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
    <Card className="relative overflow-hidden p-5">
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-[3px]", accentBars[tone])}
      />
      <div className="flex items-start justify-between gap-4 pl-2">
        <div className="space-y-2.5 min-w-0">
          <p className="ps-eyebrow">{label}</p>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="ps-display text-[34px] leading-[1]">{value}</span>
          </div>
          <p className="text-[13px] leading-[1.5] text-[rgb(var(--ps-muted))] max-w-[20rem]">
            {detail}
          </p>
        </div>
        {icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--ps-line)/0.16)] bg-[rgb(var(--ps-surface-2))] text-[rgb(var(--ps-accent))]">
            {icon}
          </div>
        ) : null}
      </div>
      {meta ? <div className="pt-4 pl-2">{meta}</div> : null}
    </Card>
  );
}
