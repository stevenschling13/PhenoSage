import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AnalysisIcon,
  ArrowUpRightIcon,
  AssistantIcon,
  BellIcon,
  CheckCircleIcon,
  LogoMark,
  PlantIcon,
  SparkIcon,
  TimelineIcon,
} from "@/components/icons";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  ElevatedCard,
} from "@/components/ui/card";
import { getServerSession } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Cultivation Intelligence",
};

const capabilityList = [
  {
    description:
      "Turn each canopy image into severity-ranked observations and concrete interventions.",
    icon: AnalysisIcon,
    title: "Visual plant doctor",
  },
  {
    description:
      "Track plant drift across time instead of treating every upload like a blank slate.",
    icon: TimelineIcon,
    title: "Longitudinal tracking",
  },
  {
    description:
      "Ask an operator-grade assistant that is designed to reason over grow context, not generic prompts.",
    icon: AssistantIcon,
    title: "Grow-aware copilot",
  },
];

const trustItems = [
  "Private image storage and signed upload preparation",
  "Same-origin route boundaries for chat and analysis",
  "Structured findings with severity and recommended actions",
];

export default async function LandingPage() {
  const session = await getServerSession();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden border-b border-border bg-hero-radial">
          <div className="mx-auto grid w-full max-w-7xl gap-16 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(480px,1fr)] lg:px-8 lg:pb-24 lg:pt-20">
            <div className="flex flex-col justify-center gap-8">
              <Badge className="w-fit" tone="accent">
                AI grow operating system
              </Badge>
              <div className="space-y-6">
                <h1 className="text-balance text-5xl font-semibold tracking-[-0.05em] text-foreground sm:text-6xl lg:text-7xl">
                  Serious cultivation intelligence for operators who need clear
                  signal.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                  PhenoSage combines visual diagnostics, longitudinal plant
                  tracking, proactive operating alerts, and a grow-aware copilot
                  in one private workspace built for modern cannabis teams.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link className={buttonStyles({ size: "lg" })} href="/auth">
                  Enter the workspace
                </Link>
                <Link
                  className={buttonStyles({ size: "lg", variant: "surface" })}
                  href="#preview"
                >
                  Inspect the product
                </Link>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {trustItems.map((item) => (
                  <div
                    key={item}
                    className="rounded-[1rem] border border-border bg-surface p-4 text-sm leading-6 text-muted-foreground shadow-sm"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <ElevatedCard className="relative overflow-hidden border-border bg-surface p-6 lg:p-8">
              <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-accent/5 to-transparent" />
              <div className="relative space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-[0.75rem] border border-border bg-surface text-accent shadow-sm">
                      <LogoMark className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                        Operating view
                      </p>
                      <p className="text-sm font-semibold text-foreground">
                        Plant health command surface
                      </p>
                    </div>
                  </div>
                  <Badge tone="success">Copilot ready</Badge>
                </div>

                <div className="grid gap-4 md:grid-cols-[1.3fr_0.8fr]">
                  <div className="rounded-[1.25rem] border border-border bg-background-subtle/50 p-5">
                    <div className="mb-5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                          Latest analysis
                        </p>
                        <h2 className="mt-2 text-xl font-semibold tracking-[-0.04em] text-foreground">
                          Blue Dream, veg day 23
                        </h2>
                      </div>
                      <Badge tone="warning">Watch foliage</Badge>
                    </div>

                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-[1rem] border border-border bg-surface p-4 shadow-sm">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                            Health score
                          </p>
                          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
                            84
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-border bg-surface p-4 shadow-sm">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                            Recurrence risk
                          </p>
                          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground">
                            Low
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-border bg-surface p-4 shadow-sm">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                            Next action
                          </p>
                          <p className="mt-3 text-sm font-semibold text-foreground">
                            Verify feed EC today
                          </p>
                        </div>
                      </div>

                      <div className="rounded-[1rem] border border-border bg-surface p-4 shadow-sm">
                        <div className="mb-4 flex items-center gap-3">
                          <AnalysisIcon className="h-4 w-4 text-accent" />
                          <p className="text-sm font-semibold text-foreground">
                            Findings summary
                          </p>
                        </div>
                        <div className="space-y-3 text-sm leading-6 text-muted-foreground">
                          <div className="flex items-start justify-between gap-4 rounded-[0.75rem] border border-border bg-background-subtle/50 px-3 py-3">
                            <span>
                              Early interveinal yellowing on upper fan leaves
                            </span>
                            <Badge tone="warning">Medium</Badge>
                          </div>
                          <div className="flex items-start justify-between gap-4 rounded-[0.75rem] border border-border bg-background-subtle/50 px-3 py-3">
                            <span>
                              Canopy posture strong after last irrigation event
                            </span>
                            <Badge tone="success">Positive</Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[1.25rem] border border-border bg-background-subtle/50 p-5">
                      <div className="mb-4 flex items-center gap-3">
                        <TimelineIcon className="h-4 w-4 text-accent" />
                        <p className="text-sm font-semibold text-foreground">
                          Comparison lane
                        </p>
                      </div>
                      <div className="space-y-3">
                        <div className="rounded-[1rem] border border-border bg-surface px-4 py-3 shadow-sm">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                            Previous image set
                          </p>
                          <p className="mt-2 text-sm font-semibold text-foreground">
                            5 days ago
                          </p>
                        </div>
                        <div className="rounded-[1rem] border border-border bg-surface px-4 py-3 shadow-sm">
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                            Drift detected
                          </p>
                          <p className="mt-2 text-sm font-semibold text-foreground">
                            Mild upward chlorosis trend
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.25rem] border border-border bg-background-subtle/50 p-5">
                      <div className="mb-4 flex items-center gap-3">
                        <BellIcon className="h-4 w-4 text-accent" />
                        <p className="text-sm font-semibold text-foreground">
                          Daily alerting
                        </p>
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Surface recurring issues, nearing milestones, and
                        operator follow-up tasks without digging through a
                        journal.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </ElevatedCard>
          </div>
        </section>

        <section className="border-b border-border py-20" id="preview">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-4">
                <Badge tone="accent">Operating model</Badge>
                <h2 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-foreground">
                  One calm workspace for plant health, drift, and next actions.
                </h2>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                  PhenoSage is designed to read like a serious cultivation
                  control surface: clear hierarchy, structured evidence, and
                  minimal noise.
                </p>
              </div>
              <Link
                className={buttonStyles({ variant: "surface" })}
                href="/auth"
              >
                Start a secure workspace
              </Link>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              {capabilityList.map((item) => {
                const Icon = item.icon;

                return (
                  <Card key={item.title} className="h-full">
                    <CardHeader>
                      <div className="flex h-10 w-10 items-center justify-center rounded-[0.75rem] border border-border bg-surface text-accent shadow-sm">
                        <Icon className="h-5 w-5" />
                      </div>
                      <CardTitle>{item.title}</CardTitle>
                      <CardDescription>{item.description}</CardDescription>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-b border-border py-20">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
            <div className="space-y-4">
              <Badge tone="accent">Daily rhythm</Badge>
              <h2 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-foreground">
                Built around how cultivation teams actually work every day.
              </h2>
              <p className="text-base leading-7 text-muted-foreground">
                Capture a baseline, compare change over time, turn findings into
                action, and keep the assistant grounded in the same operating
                context.
              </p>
            </div>

            <div className="space-y-4">
              {[
                {
                  copy: "Establish a baseline image cadence per plant or canopy zone.",
                  icon: PlantIcon,
                  title: "Capture",
                },
                {
                  copy: "Review severity-ranked findings with the latest comparison context attached.",
                  icon: AnalysisIcon,
                  title: "Diagnose",
                },
                {
                  copy: "Convert recommendations into concrete daily operating actions.",
                  icon: CheckCircleIcon,
                  title: "Act",
                },
                {
                  copy: "Ask the copilot to explain drift, recurrence, and stage-aware follow-up.",
                  icon: SparkIcon,
                  title: "Refine",
                },
              ].map((item, index) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.title}
                    className="flex gap-4 rounded-[1.25rem] border border-border bg-surface p-5 shadow-sm"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.75rem] border border-border bg-surface text-accent shadow-sm">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                        Step {index + 1}
                      </p>
                      <p className="text-lg font-semibold tracking-[-0.04em] text-foreground">
                        {item.title}
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {item.copy}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
            <div className="space-y-4">
              <Badge tone="accent">Credibility first</Badge>
              <h2 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-foreground">
                A product foundation strong enough to keep investing in.
              </h2>
              <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                The product shell is intentionally calm, data-rich, and mobile
                capable so operators can trust what the system is telling them.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link className={buttonStyles({ size: "lg" })} href="/auth">
                Enter the workspace
              </Link>
              <Link
                className={buttonStyles({ size: "lg", variant: "surface" })}
                href="/auth"
              >
                Review secure access
                <ArrowUpRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-border bg-background/80">
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
