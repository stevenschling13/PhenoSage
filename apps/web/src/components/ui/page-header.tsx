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
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-4">
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
        <div className="space-y-3">
          <h1 className="text-balance text-3xl font-semibold tracking-[-0.05em] text-foreground sm:text-4xl">
            {title}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
            {description}
          </p>
        </div>
      </div>
      {actions ? (
        <div className={cn("flex flex-wrap items-center gap-3 lg:justify-end")}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
