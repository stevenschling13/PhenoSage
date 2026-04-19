import Link from "next/link";
import { LogoMark } from "@/components/icons";
import { buttonStyles } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/78 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link className="flex items-center gap-3" href="/">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-soft">
            <LogoMark className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              PhenoSage
            </p>
            <p className="text-sm font-medium text-foreground">
              Cultivation Intelligence
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            className={buttonStyles({ size: "sm", variant: "ghost" })}
            href="#preview"
          >
            Product view
          </Link>
          <Link className={buttonStyles({ size: "sm" })} href="/auth">
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}
