import type { Metadata } from "next";
import Link from "next/link";
import {
  ActivityIcon,
  AlertIcon,
  AnalysisIcon,
  AssistantIcon,
  BellIcon,
  GrowIcon,
  ShieldIcon,
  SparkIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { getServerUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Dashboard" };

const readinessItems = [
  "Auth and workspace routing are active",
  "Chat route is ready for streamed assistant replies",
  "Upload signing route is in place for secure image intake",
];

export default async function DashboardPage() {
  const user = await getServerUser();
  const operator =
    user?.email
      ?.split("@")[0]
      ?.replace(/[._-]+/g, " ")
      ?.trim() || "grower";
  const displayName = operator.replace(/\b\w/g, (character) =>
    character.toUpperCase(),
  );

  return (
    <main className="app-page">
      <PageHeader
        actions={
          <>
            <Link
              className={buttonStyles({ size: "md", variant: "surface" })}
              href="/assistant"
            >
              Ask copilot
            </Link>
            <Link className={buttonStyles({ size: "md" })} href="/grows">
              Review grows
            </Link>
          </>
        }
        breadcrumbs={[{ label: "Dashboard" }]}
        description="Monitor plant health, watch for drift, and keep the next cultivation action visible without digging through disconnected tools."
        eyebrow={<Badge tone="accent">Workspace overview</Badge>}
        title={`Welcome back, ${displayName}`}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          detail="Create a grow and add the first plant records to establish a working surface."
          icon={<GrowIcon className="h-5 w-5" />}
          label="Active grows"
          tone="accent"
          value="No signal yet"
        />
        <StatCard
          detail="The first image set establishes your longitudinal comparison baseline."
          icon={<AnalysisIcon className="h-5 w-5" />}
          label="Latest health score"
          tone="warning"
          value="Awaiting baseline"
        />
        <StatCard
          detail="Severity-ranked watch items will appear here once analysis starts running."
          icon={<AlertIcon className="h-5 w-5" />}
          label="Open watch items"
          value="0"
        />
        <StatCard
          detail="The assistant route is live and ready for grow-context-aware reasoning."
          icon={<AssistantIcon className="h-5 w-5" />}
          label="Copilot"
          meta={<Badge tone="success">Route online</Badge>}
          tone="success"
          value="Ready"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Recent operating activity</CardTitle>
            <CardDescription>
              Once grow data is flowing, this panel will summarize the latest
              uploads, findings, and operator actions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              description="No images, events, or findings have landed in the workspace yet. Use the grow setup flow to establish the first operating record."
              icon={<ActivityIcon className="h-5 w-5" />}
              title="No recent activity"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next recommended actions</CardTitle>
            <CardDescription>
              Onboarding tasks that set up a reliable baseline for image
              analysis and assistant context.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              "Create the first grow record with stage, medium, and light profile.",
              "Add one or more plant records so image history has a stable home.",
              "Upload a consistent baseline photo set from the plant detail view.",
              "Use the copilot to turn the first findings into an operating checklist.",
            ].map((item, index) => (
              <div
                key={item}
                className="flex gap-4 rounded-[1rem] border border-border bg-background-subtle/50 px-4 py-4"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface border border-border font-mono text-sm font-semibold text-accent shadow-sm">
                  {index + 1}
                </div>
                <p className="text-sm leading-6 text-foreground">{item}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>What this board will surface</CardTitle>
            <CardDescription>
              The operating view is designed to explain what matters now, not
              just show data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="rounded-[1rem] border border-border bg-background-subtle/50 p-4">
              Severity-ranked findings with recommended follow-up.
            </div>
            <div className="rounded-[1rem] border border-border bg-background-subtle/50 p-4">
              Longitudinal drift and recurrence across image sets.
            </div>
            <div className="rounded-[1rem] border border-border bg-background-subtle/50 p-4">
              Daily action queues generated from recent activity and stage
              context.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plant health summary</CardTitle>
            <CardDescription>
              This panel is reserved for the most recent health signals once the
              first analysis finishes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              description="Upload a plant image from the plant detail page to establish the first health score and findings summary."
              icon={<SparkIcon className="h-5 w-5" />}
              title="Health summary pending"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform readiness</CardTitle>
            <CardDescription>
              Honest product status instead of placeholder vanity metrics.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {readinessItems.map((item, index) => (
              <div
                key={item}
                className="flex items-start gap-3 rounded-[1rem] border border-border bg-background-subtle/50 px-4 py-4"
              >
                {index === 0 ? (
                  <ShieldIcon className="mt-0.5 h-4 w-4 text-accent" />
                ) : index === 1 ? (
                  <SparkIcon className="mt-0.5 h-4 w-4 text-accent" />
                ) : (
                  <BellIcon className="mt-0.5 h-4 w-4 text-accent" />
                )}
                <p className="text-sm leading-6 text-foreground">{item}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
