import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { ChevronRightIcon } from "@/components/icons";

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
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-5">
          {breadcrumbs?.length ? (
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {breadcrumbs.map((item, index) => (
                  <li
                    key={`${item.label}-${index}`}
                    className="flex items-center gap-2"
                  >
                    {index > 0 ? (
                      <ChevronRightIcon className="h-4 w-4 text-border-strong" />
                    ) : null}
                    {item.href ? (
                      <Link className="hover:text-foreground" href={item.href}>
                        {item.label}
                      </Link>
                    ) : (
                      <span aria-current="page" className="text-foreground">
                        {item.label}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          {eyebrow ? <div>{eyebrow}</div> : null}
          <div className="space-y-4">
            <h1 className="text-balance max-w-4xl text-3xl font-semibold tracking-[-0.06em] text-foreground sm:text-4xl lg:text-[2.7rem]">
              {title}
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground sm:text-base">
              {description}
            </p>
          </div>
        </div>
        {actions ? (
          <div
            className={cn(
              "flex flex-wrap items-center gap-3 lg:max-w-[28rem] lg:justify-end",
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <span className="metric-chip">Operator-first workspace</span>
        <span className="metric-chip">Same-origin secured</span>
        <span className="metric-chip">Evidence over noise</span>
      </div>
    </header>
  );
}
