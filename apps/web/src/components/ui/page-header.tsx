import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

interface BreadcrumbItem {
  href?: string;
  label: string;
}

export function PageHeader({
  actions,
  breadcrumbs,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  description: string;
  eyebrow?: ReactNode;
  title: string;
}) {
  return (
    <header className="workspace-hero">
      {breadcrumbs?.length ? (
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="ps-mono flex flex-wrap items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[rgb(var(--ps-muted))]">
            {breadcrumbs.map((item, index) => (
              <li
                key={`${item.label}-${index}`}
                className="flex items-center gap-1.5"
              >
                {index > 0 ? (
                  <ChevronRightIcon className="h-3 w-3 opacity-60" />
                ) : null}
                {item.href ? (
                  <Link
                    className="transition-colors hover:text-[rgb(var(--ps-ink))]"
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    aria-current="page"
                    className="text-[rgb(var(--ps-ink))]"
                  >
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3 max-w-3xl">
          {eyebrow ? <div>{eyebrow}</div> : null}
          <h1
            className={cn(
              "ps-display text-balance text-[34px] leading-[1.04] sm:text-[44px] lg:text-[52px]",
            )}
          >
            {title}
          </h1>
          <p className="text-[14.5px] leading-[1.55] text-[rgb(var(--ps-muted))] sm:text-[15.5px]">
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2.5 lg:max-w-[28rem] lg:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
