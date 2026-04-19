import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      {children}
      <footer className="border-t border-border/70 bg-background/80">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            PhenoSage is built for serious growers who need signal, not noise.
          </p>
          <p>Private images. Structured findings. Same-origin AI routes.</p>
        </div>
      </footer>
    </div>
  );
}
