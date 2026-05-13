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
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
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

function formatGreeting(now: Date) {
  const hour = now.getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatTodayLabel(now: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  })
    .format(now)
    .toUpperCase();
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
  const firstName = displayName.split(/\s+/)[0] ?? displayName;
  const activeGrowCount = overview.totals.grows;
  const hasWorkspaceData = activeGrowCount > 0;
  const highlightedGrow = overview.grows[0] ?? null;
  const now = new Date();
  const greeting = formatGreeting(now);
  const todayLabel = formatTodayLabel(now);
  const openCount = overview.openFindings;
  const captureCount = overview.totals.images;
  const lastCapture = formatDateLabel(overview.recentActivity.lastCaptureAt);

  return (
    <main className="app-page outline-none" id="main-content" tabIndex={-1}>
      {/* ── Editorial header ─────────────────────────── */}
      <header className="workspace-hero">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3 max-w-3xl">
            <p className="ps-eyebrow">{todayLabel}</p>
            <h1 className="ps-display text-balance text-[34px] leading-[1.04] sm:text-[44px] lg:text-[52px]">
              {greeting}, {firstName}.
            </h1>
            <p className="text-[14.5px] leading-[1.55] text-[rgb(var(--ps-muted))] sm:text-[15.5px]">
              The day&rsquo;s plant health, drift, and the next cultivation
              action — all in one quiet operating board.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
            <Link
              className={buttonStyles({ size: "md", variant: "outline" })}
              href="/assistant"
            >
              Ask copilot
            </Link>
            <Link
              className={buttonStyles({ size: "md", variant: "primary" })}
              href="/grows/new"
            >
              New grow
            </Link>
          </div>
        </div>
      </header>

      {/* ── Ritual band (today's hook) ───────────────── */}
      <Card className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="ps-trichome-bg pointer-events-none absolute inset-0 opacity-60"
        />
        <CardContent className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[rgb(var(--ps-accent-soft))] text-[rgb(var(--ps-accent-strong))]"
            >
              <SparkIcon className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <p className="text-[15px] leading-[1.4] text-[rgb(var(--ps-ink))]">
                <span className="font-medium">
                  {hasWorkspaceData
                    ? `${overview.totals.plants} plants tracked across ${activeGrowCount} grow${activeGrowCount === 1 ? "" : "s"}.`
                    : "No plants tracked yet."}
                </span>{" "}
                <span className="text-[rgb(var(--ps-muted))]">
                  {openCount > 0
                    ? `Sage flagged ${openCount} item${openCount === 1 ? "" : "s"} to look at first.`
                    : hasWorkspaceData
                      ? "Quietly going right — nothing to chase."
                      : "Set up the first grow to wake the operating board."}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-baseline gap-2 self-end sm:self-auto sm:flex-col sm:items-end sm:gap-0">
            <span className="ps-display text-[28px] leading-[1] text-[rgb(var(--ps-ink))]">
              {captureCount}
            </span>
            <span className="ps-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--ps-muted))]">
              captures
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Stat row ─────────────────────────────────── */}
      <section className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          detail={
            hasWorkspaceData
              ? "Rooms or programs currently active in the workspace."
              : "Create the first grow to establish a structured operating surface."
          }
          icon={<GrowIcon className="h-5 w-5" />}
          label="Active grows"
          tone="accent"
          value={activeGrowCount === 0 ? "—" : String(activeGrowCount)}
        />
        <StatCard
          detail={
            captureCount > 0
              ? `Latest capture landed ${lastCapture}.`
              : "The first image set establishes your longitudinal baseline."
          }
          icon={<AnalysisIcon className="h-5 w-5" />}
          label="Capture history"
          tone="warning"
          value={captureCount === 0 ? "—" : String(captureCount)}
        />
        <StatCard
          detail="Unresolved findings that still need operator attention."
          icon={<AlertIcon className="h-5 w-5" />}
          label="Open watch items"
          tone={openCount === 0 ? "success" : "warning"}
          value={String(openCount)}
        />
        <StatCard
          detail={
            overview.recentFindings.length > 0
              ? "The composer posts to /api/chat and grounds replies in persisted findings."
              : "Composer is enabled — useful answers still depend on uploads and findings."
          }
          icon={<AssistantIcon className="h-5 w-5" />}
          label="Copilot route"
          meta={<Badge tone="success">Composer enabled</Badge>}
          tone="success"
          value="Ready"
        />
      </section>

      {/* ── Activity + next actions ──────────────────── */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)]">
        <Card>
          <CardContent className="space-y-4 p-6">
            <SectionHeader
              label="Recent operating activity"
              trailing={
                overview.recentFindings.length > 0
                  ? `${overview.recentFindings.length} surfaced`
                  : "quiet"
              }
            />
            {overview.recentFindings.length > 0 ? (
              <div className="flex flex-col">
                {overview.recentFindings.map((finding, idx) => (
                  <div
                    key={finding.id}
                    className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                    style={
                      idx === 0
                        ? undefined
                        : {
                            borderTop:
                              "1px solid rgb(var(--ps-line) / var(--ps-line-strength))",
                          }
                    }
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
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
                        <span className="ps-mono text-[10.5px] uppercase tracking-[0.12em] text-[rgb(var(--ps-muted))]">
                          {formatDateLabel(finding.createdAt)}
                        </span>
                      </div>
                      <p className="text-[14.5px] font-medium leading-[1.35] text-[rgb(var(--ps-ink))]">
                        {finding.title}
                      </p>
                      <p className="text-[13px] leading-[1.5] text-[rgb(var(--ps-muted))]">
                        {finding.plantName}
                      </p>
                    </div>
                    <Link
                      className={buttonStyles({
                        size: "sm",
                        variant: "outline",
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
          <CardContent className="space-y-4 p-6">
            <SectionHeader
              label="Next recommended actions"
              trailing="ordered"
            />
            <div className="flex flex-col gap-2.5">
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
                  className="flex gap-3.5 rounded-[14px] border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface-2)/0.55)] px-4 py-3.5"
                >
                  <div className="ps-mono flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--ps-surface))] text-[12px] font-medium text-[rgb(var(--ps-accent-strong))]">
                    {index + 1}
                  </div>
                  <p className="text-[13.5px] leading-[1.5] text-[rgb(var(--ps-ink))]">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Operating context trio ───────────────────── */}
      <section className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardContent className="space-y-4 p-6">
            <SectionHeader label="What this board surfaces" />
            <div className="flex flex-col gap-2.5 text-[13.5px] leading-[1.55] text-[rgb(var(--ps-ink-2))]">
              {[
                "Severity-ranked findings with recommended follow-up.",
                "Longitudinal drift and recurrence across image sets.",
                "Daily action queues generated from recent activity and stage context.",
              ].map((line) => (
                <div
                  key={line}
                  className="rounded-[14px] border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface-2)/0.55)] p-3.5"
                >
                  {line}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 p-6">
            <SectionHeader
              label="Grow registry pulse"
              trailing={
                overview.grows.length > 0
                  ? `${overview.grows.length} live`
                  : "—"
              }
            />
            {overview.grows.length > 0 ? (
              <div className="flex flex-col gap-2.5">
                {overview.grows.slice(0, 3).map((grow) => (
                  <div
                    key={grow.id}
                    className="rounded-[14px] border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface-2)/0.55)] px-4 py-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium leading-tight text-[rgb(var(--ps-ink))]">
                          {grow.name}
                        </p>
                        <p className="ps-mono mt-1.5 text-[10.5px] uppercase tracking-[0.1em] text-[rgb(var(--ps-muted))]">
                          {grow.stage ?? "stage pending"} · {grow.plantCount}{" "}
                          plants · {grow.imageCount} captures
                        </p>
                      </div>
                      {grow.primaryPlantId ? (
                        <Link
                          className={buttonStyles({
                            size: "sm",
                            variant: "outline",
                          })}
                          href={`/plants/${grow.primaryPlantId}`}
                        >
                          Open
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
          <CardContent className="space-y-4 p-6">
            <SectionHeader label="Platform readiness" trailing="all on" />
            <div className="flex flex-col gap-2.5">
              {[
                {
                  Icon: ShieldIcon,
                  text: "Authenticated grow and plant creation flows are active.",
                },
                {
                  Icon: SparkIcon,
                  text: "The assistant composer posts to the same-origin chat route.",
                },
                {
                  Icon: BellIcon,
                  text: "Signed uploads persist into plant timelines before analysis runs.",
                },
              ].map(({ Icon, text }) => (
                <div
                  key={text}
                  className="flex items-start gap-3 rounded-[14px] border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface-2)/0.55)] px-4 py-3.5"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--ps-accent))]" />
                  <p className="text-[13.5px] leading-[1.55] text-[rgb(var(--ps-ink))]">
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
