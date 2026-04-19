import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import {
  ArrowRightIcon,
  BellIcon,
  ChatIcon,
  LeafIcon,
  ScopeIcon,
  SparklesIcon,
  TrendIcon,
} from "@/components/ui/icons";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";

const PILLARS = [
  {
    Icon: ScopeIcon,
    title: "Visual Grow Doctor",
    description:
      "Upload a photo, get structured findings ranked by severity with concrete recommendations.",
  },
  {
    Icon: TrendIcon,
    title: "Longitudinal Intelligence",
    description:
      "Compare new shots to prior uploads. Trend health scores across the entire grow cycle.",
  },
  {
    Icon: ChatIcon,
    title: "Grow-aware Copilot",
    description:
      "Chat with an AI grounded in your strains, observations, and environment — not the open web.",
  },
  {
    Icon: BellIcon,
    title: "Proactive Alerts",
    description:
      "Daily summaries, generated tasks, and stage-aware reminders so nothing slips.",
  },
];

const PRINCIPLES = [
  {
    label: "Web-first",
    body: "No app store gates. Open a URL, get to work — desktop, tablet, or phone.",
  },
  {
    label: "Privacy-respecting",
    body: "Photos and chat live behind row-level security. Service-role keys never leave the server.",
  },
  {
    label: "AI as copilot",
    body: "Suggestions are auditable. You approve before anything mutates your grow.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <Container
          width="xl"
          className="flex h-16 items-center justify-between"
        >
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
            >
              <LeafIcon width={18} height={18} />
            </span>
            <span>PhenoSage</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
            >
              <Link href="/auth">Sign in</Link>
            </Button>
            <Button
              asChild
              size="sm"
              rightIcon={<ArrowRightIcon width={14} height={14} />}
            >
              <Link href="/auth">Get started</Link>
            </Button>
          </div>
        </Container>
      </header>

      <main id="main-content" tabIndex={-1} className="outline-none">
        {/* Hero */}
        <section className="bg-hero-gradient">
          <Container width="xl" className="py-20 sm:py-28 lg:py-32">
            <div className="mx-auto flex max-w-3xl flex-col items-center text-center animate-fade-in-up">
              <Badge variant="info" className="mb-5">
                <SparklesIcon width={14} height={14} className="mr-1.5" />
                Web-first AI grow OS
              </Badge>
              <h1 className="text-balance text-5xl font-semibold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
                Your plants deserve{" "}
                <span className="bg-gradient-to-r from-primary to-success bg-clip-text text-transparent">
                  professional intelligence
                </span>
              </h1>
              <p className="mt-6 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
                PhenoSage combines visual AI diagnosis, longitudinal plant
                tracking, a grow-aware chatbot, and proactive alerts — all in
                one fast web app.
              </p>
              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  rightIcon={<ArrowRightIcon width={16} height={16} />}
                >
                  <Link href="/auth">Get started free</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/dashboard">View demo</Link>
                </Button>
              </div>
              <p className="mt-6 text-xs text-muted-foreground">
                No credit card. RLS-secured. Cancel anytime.
              </p>
            </div>
          </Container>
        </section>

        {/* Pillars */}
        <section className="border-t border-border bg-card">
          <Container width="xl" className="py-20 sm:py-24">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-primary">
                The four pillars
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Everything a grower actually needs
              </h2>
              <p className="mt-3 text-muted-foreground">
                Built around the work, not the dashboard.
              </p>
            </div>
            <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {PILLARS.map(({ Icon, title, description }) => (
                <Card
                  key={title}
                  className="group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elevation-2"
                >
                  <CardContent className="p-6 pt-6">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon width={22} height={22} />
                    </div>
                    <h3 className="text-base font-semibold text-foreground">
                      {title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </Container>
        </section>

        {/* Principles */}
        <section className="border-t border-border">
          <Container width="xl" className="py-20 sm:py-24">
            <div className="grid gap-8 lg:grid-cols-3">
              {PRINCIPLES.map((p) => (
                <div
                  key={p.label}
                  className="border-l-2 border-primary/40 pl-5"
                >
                  <p className="text-sm font-semibold text-primary">
                    {p.label}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {p.body}
                  </p>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* CTA */}
        <section className="border-t border-border bg-accent/40">
          <Container width="md" className="py-16 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Ready to give your grow a copilot?
            </h2>
            <p className="mt-2 text-muted-foreground">
              Sign in with email and you&apos;re tracking your first plant in 60
              seconds.
            </p>
            <div className="mt-6 flex justify-center">
              <Button
                asChild
                size="lg"
                rightIcon={<ArrowRightIcon width={16} height={16} />}
              >
                <Link href="/auth">Create your account</Link>
              </Button>
            </div>
          </Container>
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <Container
          width="xl"
          className="flex flex-col items-center justify-between gap-2 py-8 text-xs text-muted-foreground sm:flex-row"
        >
          <p>
            © {new Date().getFullYear()} PhenoSage. Web-first,
            privacy-respecting.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/auth" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
          </div>
        </Container>
      </footer>
    </div>
  );
}
