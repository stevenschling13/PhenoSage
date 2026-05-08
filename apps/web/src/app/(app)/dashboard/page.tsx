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
import { getCurrentProfile } from "@/lib/server/profile";
import { getWorkspaceOverview } from "@/lib/server/workspace-overview";

export const metadata: Metadata = { title: "Dashboard" };

function formatDateLabel(value: string | null) {
  if (!value) {
    return "No activity yet";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export default async function DashboardPage() {
  const [profile, overview] = await Promise.all([
    getCurrentProfile(),
    getWorkspaceOverview(),
  ]);
  const operator =
    profile?.displayName?.trim() ||
    profile?.email
      ?.split("@")[0]
      ?.replace(/[._-]+/g, " ")
      .trim() ||
    "grower";
  const displayName = operator.replace(/\b\w/g, (character) =>
    character.toUpperCase(),
  );
  const activeGrowCount = overview.totals.grows;
  const hasWorkspaceData = activeGrowCount > 0;
  const highlightedGrow = overview.grows[0] ?? null;

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
            <Link className={buttonStyles({ size: "md" })} href="/grows/new">
              New grow
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
          detail={
            hasWorkspaceData
              ? "Rooms or programs currently active in the workspace."
              : "Create the first grow to establish a structured operating surface."
          }
          icon={<GrowIcon className="h-5 w-5" />}
          label="Active grows"
          tone="accent"
          value={activeGrowCount === 0 ? "None yet" : String(activeGrowCount)}
        />
        <StatCard
          detail={
            overview.totals.images > 0
              ? `Latest capture landed ${formatDateLabel(overview.recentActivity.lastCaptureAt)}.`
              : "The first image set establishes your longitudinal comparison baseline."
          }
          icon={<AnalysisIcon className="h-5 w-5" />}
          label="Capture history"
          tone="warning"
          value={
            overview.totals.images === 0
              ? "Awaiting baseline"
              : `${overview.totals.images} captures`
          }
        />
        <StatCard
          detail="Unresolved findings that still need operator attention."
          icon={<AlertIcon className="h-5 w-5" />}
          label="Open watch items"
          value={String(overview.openFindings)}
        />
        <StatCard
          detail={
            overview.recentFindings.length > 0
              ? "The composer posts to /api/chat and can ground replies in persisted findings."
              : "The composer is enabled, but useful answers still depend on actual uploads and findings."
          }
          icon={<AssistantIcon className="h-5 w-5" />}
          label="Assistant route"
          meta={<Badge tone="success">Composer enabled</Badge>}
          tone="success"
          value="Connected"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Recent operating activity</CardTitle>
            <CardDescription>
              The dashboard should answer what moved, what changed, and what
              needs attention without making you hunt through pages.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview.recentFindings.length > 0 ? (
              <div className="space-y-3">
                {overview.recentFindings.map((finding) => (
                  <div
                    key={finding.id}
                    className="flex items-start justify-between gap-4 rounded-[1.1rem] border border-border/70 bg-background-subtle/65 px-4 py-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            finding.severity === "critical" ||
                            finding.severity === "high"
                              ? "danger"
                              : finding.severity === "medium"
                                ? "warning"
                                : "accent"
                          }
                        >
                          {finding.severity}
                        </Badge>
                        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {formatDateLabel(finding.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-foreground">
                        {finding.title}
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {finding.plantName}
                      </p>
                    </div>
                    <Link
                      className={buttonStyles({
                        size: "sm",
                        variant: "surface",
                      })}
                      href={`/plants/${finding.plantId}`}
                    >
                      Review
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                description="No images, events, or findings have landed in the workspace yet. Use the grow setup flow to establish the first operating record."
                icon={<ActivityIcon className="h-5 w-5" />}
                title="No recent activity"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next recommended actions</CardTitle>
            <CardDescription>
              Sequenced work that moves the workspace from setup into a usable
              operating loop.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(hasWorkspaceData
              ? [
                  highlightedGrow?.primaryPlantId
                    ? `Open ${highlightedGrow.primaryPlantName ?? "the primary plant"} and capture a fresh image from the same angle as the last baseline.`
                    : "Add the first plant to your most recent grow so image history has a stable home.",
                  overview.openFindings > 0
                    ? "Review unresolved findings and convert them into a clear action checklist with the copilot."
                    : "Use the copilot to define the next repeatable capture cadence before new findings arrive.",
                  "Record observations after feed, irrigation, or environment changes so timeline context stays useful.",
                  "Keep one grow as the clean reference surface for stage, medium, and light metadata.",
                ]
              : [
                  "Create the first grow record with stage, medium, and light profile.",
                  "Add one or more plant records so image history has a stable home.",
                  "Upload a consistent baseline photo set from the plant detail view.",
                  "Use the copilot to turn the first findings into an operating checklist.",
                ]
            ).map((item, index) => (
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
            <CardTitle>Grow registry pulse</CardTitle>
            <CardDescription>
              A compact view of where the next meaningful work is likely to
              happen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview.grows.length > 0 ? (
              <div className="space-y-3">
                {overview.grows.slice(0, 3).map((grow) => (
                  <div
                    key={grow.id}
                    className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {grow.name}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {grow.stage ?? "stage pending"} · {grow.plantCount}{" "}
                          plants · {grow.imageCount} captures
                        </p>
                      </div>
                      {grow.primaryPlantId ? (
                        <Link
                          className={buttonStyles({
                            size: "sm",
                            variant: "surface",
                          })}
                          href={`/plants/${grow.primaryPlantId}`}
                        >
                          Open plant
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                description="Create the first grow to move the dashboard from structure into a real operating board."
                icon={<SparkIcon className="h-5 w-5" />}
                title="Grow registry still empty"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform readiness</CardTitle>
            <CardDescription>
              Honest product posture instead of placeholder vanity metrics.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              "Authenticated grow and plant creation flows are active",
              "The assistant composer posts to the same-origin chat route",
              "Signed uploads persist into plant timelines before analysis runs",
            ].map((item, index) => (
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
