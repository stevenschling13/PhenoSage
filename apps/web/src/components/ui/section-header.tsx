import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Editorial section header — a small mono uppercase label with an optional
 * trailing slot for counts, filters, or links. Used inside cards to title
 * dense regions without competing with the page H1.
 */
export function SectionHeader({
  label,
  trailing,
  className,
}: {
  label: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ps-section-head", className)}>
      <span className="ps-eyebrow">{label}</span>
      {trailing ? (
        <div className="ps-mono text-[11px] text-[rgb(var(--ps-muted))]">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
