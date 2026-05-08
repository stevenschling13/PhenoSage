import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeftIcon,
  LeafIcon,
  CheckCircleIcon,
} from "@/components/ui/icons";
import { tryGetServerUser } from "@/lib/server/auth";
import {
  AUTH_MISCONFIGURED,
  getAuthConfigViolations,
} from "@/lib/server/auth-errors";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign In" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ error?: string; next?: string }>;

const HIGHLIGHTS = [
  "Visual AI diagnosis on every photo",
  "Longitudinal trend tracking across grows",
  "Grow-aware copilot grounded in your data",
  "Daily alerts so issues never linger",
];

export default async function AuthPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await tryGetServerUser();
  if (user) redirect("/dashboard");

  const { error } = await searchParams;

  // If Supabase isn't configured for this deployment, surface a friendly
  // banner instead of letting the form submit and fail with "fetch failed".
  const configMissing = getAuthConfigViolations().length > 0;
  const initialError = configMissing ? AUTH_MISCONFIGURED : error;

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="relative min-h-screen bg-background outline-none"
    >
      {/* Top utility bar */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon width={16} height={16} />
          Back home
        </Link>
        <ThemeToggle />
      </div>

      <div className="grid min-h-screen lg:grid-cols-2">
        {/* Decorative panel */}
        <aside
          aria-hidden="true"
          className="relative hidden overflow-hidden bg-hero-gradient lg:flex lg:flex-col lg:justify-between lg:p-12"
        >
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <LeafIcon width={18} height={18} />
            </span>
            <span>PhenoSage</span>
          </div>

          <div className="max-w-md">
            <p className="text-xs font-medium uppercase tracking-wider text-primary">
              Built for serious growers
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              A second pair of eyes on every plant.
            </h2>
            <ul className="mt-6 space-y-3">
              {HIGHLIGHTS.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 text-sm text-muted-foreground"
                >
                  <CheckCircleIcon
                    width={18}
                    height={18}
                    className="mt-0.5 shrink-0 text-primary"
                  />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} PhenoSage
          </p>
        </aside>

        {/* Form panel */}
        <section className="flex items-center justify-center px-5 py-20 sm:px-8">
          <div className="w-full max-w-sm">
            <div className="mb-6 flex items-center gap-2 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <LeafIcon width={18} height={18} />
              </span>
              <span className="font-semibold tracking-tight">PhenoSage</span>
            </div>
            <Card className="shadow-elevation-2">
              <CardContent className="space-y-6 p-6 sm:p-8">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                    Welcome back
                  </h1>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Sign in or create an account to start tracking grows.
                  </p>
                </div>
                <SignInForm {...(initialError ? { initialError } : {})} />
              </CardContent>
            </Card>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Protected by Supabase Auth · Row-level security on every query.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
