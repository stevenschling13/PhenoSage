import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  AnalysisIcon,
  ArrowUpRightIcon,
  AssistantIcon,
  ShieldIcon,
  TimelineIcon,
} from "@/components/icons";
import { AuthForm } from "@/components/AuthForm";
import { Badge } from "@/components/ui/badge";
import {
  CardDescription,
  CardHeader,
  CardTitle,
  ElevatedCard,
} from "@/components/ui/card";
import { getServerSession } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Access Workspace" };

const authBenefits = [
  {
    copy: "Structured image findings, severity ranking, and recommended follow-up without exposing private services client-side.",
    icon: AnalysisIcon,
    title: "Visual plant doctor",
  },
  {
    copy: "Plant timelines and future comparisons stay organized in one operating context.",
    icon: TimelineIcon,
    title: "Longitudinal tracking",
  },
  {
    copy: "Copilot responses are ready to reason over grow history and route-scoped data.",
    icon: AssistantIcon,
    title: "Operator copilot",
  },
];

export default async function AuthPage() {
  const session = await getServerSession();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto grid min-h-[calc(100vh-8rem)] w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,0.9fr)] lg:px-8 lg:py-16">
      <section className="flex flex-col justify-between gap-10">
        <div className="space-y-6">
          <Badge tone="accent">Secure operator access</Badge>
          <div className="space-y-5">
            <h1 className="text-balance text-5xl font-semibold tracking-[-0.07em] text-foreground sm:text-6xl">
              Enter a calm workspace built for real cultivation decisions.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Authentication is the handoff between public product marketing and
              a private operating surface where plant images, diagnostics, and
              assistant context stay contained.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {authBenefits.map((item) => {
            const Icon = item.icon;

            return (
              <div
                key={item.title}
                className="flex gap-4 rounded-[1.5rem] border border-border/70 bg-surface/82 p-5 shadow-soft"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.2rem] bg-accent/10 text-accent">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-lg font-semibold tracking-[-0.04em] text-foreground">
                      {item.title}
                    </p>
                    <ArrowUpRightIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {item.copy}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-[1.5rem] border border-border/70 bg-background-subtle/70 p-5">
          <div className="mb-3 flex items-center gap-3">
            <ShieldIcon className="h-5 w-5 text-accent" />
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Workspace posture
            </p>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Route handlers remain same-origin, uploads are prepared server-side,
            and private grow data stays behind authenticated boundaries.
          </p>
        </div>
      </section>

      <ElevatedCard className="self-center p-2 sm:p-3">
        <div className="rounded-[1.65rem] border border-border/70 bg-surface px-5 py-6 sm:px-7 sm:py-7">
          <CardHeader className="px-0 pt-0">
            <Badge className="w-fit" tone="accent">
              Private workspace access
            </Badge>
            <CardTitle className="text-3xl sm:text-[2rem]">
              Authenticate with confidence
            </CardTitle>
            <CardDescription>
              Use secure email and password authentication to enter PhenoSage.
            </CardDescription>
          </CardHeader>
          <AuthForm />
        </div>
      </ElevatedCard>
    </main>
  );
}
