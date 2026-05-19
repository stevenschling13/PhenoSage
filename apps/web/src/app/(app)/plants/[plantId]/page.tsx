import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { AnalysisFinding } from "@phenosage/shared";
import {
  AnalysisIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  PlantIcon,
  SparkIcon,
  TimelineIcon,
} from "@/components/icons";
import { LiveAnalysisRefresher } from "@/components/live-analysis-refresher";
import { UploadPhotoPanel } from "@/components/upload-photo-panel";
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
import { WhatChangedPanel } from "@/components/what-changed-panel";
import { HealthTrendChart } from "@/components/health-trend-chart";
import { getAuthorizedPlantContext } from "@/lib/server/plant-access";
import { getLatestPlantAnalysis, getPlantTimeline } from "@/lib/server/plants";
import { getStorageClient } from "@/lib/server/storage";

export const metadata: Metadata = { title: "Plant Detail" };

interface Props {
  params: Promise<{ plantId: string }>;
}

// Plant IDs are persisted as Postgres UUIDs. Reject malformed inputs at the
// edge so we don't waste a Supabase round trip (and surface a clean 404
// instead of a generic error boundary on accidental URL typos).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildPlantActionItems(params: {
  findings: AnalysisFinding[];
  hasTimeline: boolean;
  isFallback: boolean;
}) {
  if (params.findings.length > 0) {
    return params.findings
      .slice(0, 3)
      .map((finding) =>
        finding.recommendation
          ? `${finding.title}: ${finding.recommendation}`
          : `${finding.title}: Review this signal before the next feed or environment change.`,
      );
  }

  if (params.isFallback) {
    return [
      "Retry analysis after confirming storage access and model availability.",
      "Add a note describing what changed before this capture so the next review has operator context.",
      "Capture one more image from the same framing to keep the timeline interpretable.",
    ];
  }

  if (params.hasTimeline) {
    return [
      "Capture the next image from the same angle to strengthen trend comparison.",
      "Add notes after irrigation, feed, or climate changes so the timeline stays useful.",
      "Use the copilot to translate the latest analysis into a short operating checklist.",
    ];
  }

  return [
    "Capture one baseline image with stable framing and lighting.",
    "Add notes after irrigation, feed, or major environment changes.",
    "Return after the next meaningful change to establish a comparison pair.",
  ];
}

export default async function PlantPage({ params }: Props) {
  const { plantId } = await params;
  if (!UUID_RE.test(plantId)) {
    notFound();
  }
  const context = await getAuthorizedPlantContext(plantId);

  if (!context) {
    notFound();
  }

  // Timeline + latest analysis are independent reads — fetch in parallel.
  const [timeline, latestAnalysis] = await Promise.all([
    getPlantTimeline(plantId),
    getLatestPlantAnalysis(plantId),
  ]);
  const shortId = context.plantId.slice(0, 8).toUpperCase();
  const imageItems =
    timeline?.items.filter((item) => item.type === "image") ?? [];
  const observationItems =
    timeline?.items.filter((item) => item.type === "observation") ?? [];
  const totalFindingCount = imageItems.reduce(
    (count, item) => count + item.findings.length,
    0,
  );
  const latestImage = imageItems[0] ?? null;
  const previousImage = imageItems[1] ?? null;
  const baselineLabel =
    imageItems.length === 0
      ? "Not started"
      : imageItems.length === 1
        ? "Baseline live"
        : "Trendable";
  const actionItems = buildPlantActionItems({
    findings: latestAnalysis?.findings ?? [],
    hasTimeline: imageItems.length > 0 || observationItems.length > 0,
    isFallback: latestAnalysis?.isFallback ?? false,
  });

  // Tier-1 longitudinal intelligence: collect every persisted analysis
  // attached to an image and surface the score over time. We only show
  // the chart once there are at least 2 points (the chart component
  // renders its own "needs more data" state otherwise).
  const trendPoints = imageItems
    .filter((item) => item.analysis !== null)
    .map((item) => ({
      analyzedAt: item.analysis!.analyzedAt,
      score: item.analysis!.overallHealthScore,
    }));

  // The initial signed URLs rendered into the page have a 10-minute
  // TTL; if the user keeps the tab open past that window the embedded
  // `<SignedImage>` falls back to `/api/uploads/refresh` to re-sign
  // exactly once on the first 403, keyed by `(plantId, imageId)`.
  let comparisonImages: {
    after: { imageId: string; signedUrl: string; label: string };
    before: { imageId: string; signedUrl: string; label: string };
  } | null = null;

  if (latestImage && previousImage) {
    const storage = getStorageClient().from("plant-images");
    const [{ data: latestSigned }, { data: previousSigned }] =
      await Promise.all([
        storage.createSignedUrl(latestImage.storagePath, 60 * 10),
        storage.createSignedUrl(previousImage.storagePath, 60 * 10),
      ]);

    if (latestSigned?.signedUrl && previousSigned?.signedUrl) {
      comparisonImages = {
        after: {
          imageId: latestImage.id,
          signedUrl: latestSigned.signedUrl,
          label: formatDateTime(latestImage.takenAt),
        },
        before: {
          imageId: previousImage.id,
          signedUrl: previousSigned.signedUrl,
          label: formatDateTime(previousImage.takenAt),
        },
      };
    }
  }

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
            <Link className={buttonStyles({ size: "md" })} href="#upload">
              Upload new photo
            </Link>
          </>
        }
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/grows", label: "Grows" },
          { label: context.plantName },
        ]}
        description={`Track image history, review the latest analysis, and keep plant-level decisions grounded in actual capture cadence for ${context.plantName}.`}
        eyebrow={<Badge tone="accent">Plant workspace</Badge>}
        title={context.plantName || `Plant ${shortId}`}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          detail="One baseline capture establishes the frame for future comparison."
          icon={<PlantIcon className="h-5 w-5" />}
          label="Baseline status"
          tone="accent"
          value={baselineLabel}
        />
        <StatCard
          detail={
            latestAnalysis
              ? latestAnalysis.summary
              : "Once analysis completes, the latest image score and summary appear here."
          }
          icon={<AnalysisIcon className="h-5 w-5" />}
          label="Latest health score"
          tone="warning"
          value={
            latestAnalysis
              ? `${latestAnalysis.overallHealthScore}/100`
              : "Pending"
          }
        />
        <StatCard
          detail="Severity-ranked plant findings accumulate across image sets."
          icon={<SparkIcon className="h-5 w-5" />}
          label="Open findings"
          value={String(totalFindingCount)}
        />
        <StatCard
          detail="Timeline cadence helps the copilot distinguish one-off noise from recurring patterns."
          icon={<TimelineIcon className="h-5 w-5" />}
          label="Image cadence"
          value={
            imageItems.length === 0
              ? "No history"
              : `${imageItems.length} captures`
          }
        />
      </section>

      <section className="data-strip">
        <div>
          <p className="data-kicker">Strain</p>
          <p className="data-value">{context.strain ?? "Not recorded"}</p>
          <p className="data-note">
            Keep this populated so comparisons stay anchored to the correct
            cultivar.
          </p>
        </div>
        <div>
          <p className="data-kicker">Grow stage</p>
          <p className="data-value">{context.growStage ?? "Pending"}</p>
          <p className="data-note">
            Stage-aware interpretation matters more than isolated image quality.
          </p>
        </div>
        <div>
          <p className="data-kicker">Medium and light</p>
          <p className="data-value">
            {context.medium ?? "Medium pending"} ·{" "}
            {context.lightType ?? "Light pending"}
          </p>
          <p className="data-note">
            Context sharpens both analysis output and follow-up recommendations.
          </p>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.95fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Longitudinal timeline</CardTitle>
              <CardDescription>
                Capture consistent image sets over time so PhenoSage can explain
                drift, recurrence, and trend direction.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {timeline && timeline.items.length > 0 ? (
                <div className="space-y-3">
                  {timeline.items.map((item) =>
                    item.type === "image" ? (
                      <div
                        key={item.id}
                        className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-4"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone="accent">Image</Badge>
                              <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                                {formatDateTime(item.takenAt)}
                              </span>
                              {item.analysis?.isFallback ? (
                                <Badge tone="warning">Fallback output</Badge>
                              ) : null}
                            </div>
                            <p className="text-sm leading-6 text-foreground">
                              {item.analysis?.summary ??
                                "Capture uploaded. Analysis is pending or unavailable right now."}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {item.findings.length} findings · {item.source}{" "}
                              capture
                              {item.notes ? ` · ${item.notes}` : ""}
                            </p>
                          </div>
                          <Link
                            className={buttonStyles({
                              size: "sm",
                              variant: "surface",
                            })}
                            href="/assistant"
                          >
                            Ask copilot
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={item.id}
                        className="rounded-[1.15rem] border border-border/70 bg-background-subtle/50 px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>Observation</Badge>
                          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            {formatDateTime(item.observedAt)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-foreground">
                          {item.notes ??
                            "Manual observation logged without notes."}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <EmptyState
                  description="No photos or manual observations are attached to this plant yet. Start with one baseline image, then capture from the same angle after meaningful environmental or feed changes."
                  icon={<TimelineIcon className="h-5 w-5" />}
                  title="No timeline entries"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Health score trend</CardTitle>
              <CardDescription>
                Every persisted analysis plotted in the order it was produced. A
                flat or rising line means the plant is holding or improving — a
                falling line is the agent&rsquo;s cue to flag a finding.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HealthTrendChart points={trendPoints} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest AI analysis</CardTitle>
              <CardDescription>
                The freshest summary, health score, and severity-ranked findings
                returned by the analysis pipeline.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {latestAnalysis ? (
                <>
                  <div className="rounded-[1.25rem] border border-border/70 bg-background-subtle/70 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={latestAnalysis.isFallback ? "warning" : "accent"}
                      >
                        {latestAnalysis.isFallback
                          ? "Fallback output"
                          : "Model analysis"}
                      </Badge>
                      <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        {formatDateTime(latestAnalysis.analyzedAt)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-foreground">
                      {latestAnalysis.summary}
                    </p>
                    {latestAnalysis.comparisonSummary ? (
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {latestAnalysis.comparisonSummary}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[1.2rem] border border-border/70 bg-surface/70 p-4">
                      <p className="data-kicker">Health score</p>
                      <p className="data-value">
                        {latestAnalysis.overallHealthScore}/100
                      </p>
                      <p className="data-note">
                        Latest persisted analysis result.
                      </p>
                    </div>
                    <div className="rounded-[1.2rem] border border-border/70 bg-surface/70 p-4">
                      <p className="data-kicker">Finding count</p>
                      <p className="data-value">
                        {latestAnalysis.findings.length}
                      </p>
                      <p className="data-note">
                        Signals extracted from the freshest image set.
                      </p>
                    </div>
                    <div className="rounded-[1.2rem] border border-border/70 bg-surface/70 p-4">
                      <p className="data-kicker">Analysis mode</p>
                      <p className="data-value">
                        {latestAnalysis.analysisMode === "fallback"
                          ? "Fallback"
                          : "Model"}
                      </p>
                      <p className="data-note">
                        {latestAnalysis.isFallback
                          ? "Treat this as inconclusive until the service path is healthy."
                          : "Ready to use for operating decisions."}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-[1.25rem] border border-border/70 bg-background-subtle/70 p-5">
                  <p className="text-sm leading-6 text-muted-foreground">
                    Upload a secure image set to trigger the first analysis.
                    Once real data lands, the summary will anchor this page and
                    the findings rail to the right.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What changed?</CardTitle>
              <CardDescription>
                Side-by-side review of the two latest captures, with an
                on-demand AI summary of the differences when you&rsquo;re ready
                to look.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {comparisonImages ? (
                <WhatChangedPanel
                  after={comparisonImages.after}
                  before={comparisonImages.before}
                  plantId={plantId}
                />
              ) : (
                <EmptyState
                  description="Two stored captures are required before PhenoSage can show a trustworthy side-by-side comparison surface."
                  icon={<AnalysisIcon className="h-5 w-5" />}
                  title="Comparison not ready yet"
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <div id="upload">
            <UploadPhotoPanel plantId={plantId} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Findings rail</CardTitle>
              <CardDescription>
                Severity-ranked findings will stay visible while you compare
                images.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge>Info</Badge>
                <Badge tone="accent">Low</Badge>
                <Badge tone="warning">Medium</Badge>
                <Badge tone="danger">High</Badge>
              </div>
              {latestAnalysis?.findings.length ? (
                <div className="space-y-3">
                  {latestAnalysis.findings.map((finding) => (
                    <div
                      key={`${finding.title}-${finding.description}`}
                      className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-4"
                    >
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
                        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {finding.category.replaceAll("_", " ")}
                        </span>
                        {finding.confidenceScore !== undefined ? (
                          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            {Math.round(finding.confidenceScore * 100)}%
                            confidence
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm font-semibold text-foreground">
                        {finding.title}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {finding.description}
                      </p>
                      {finding.recommendation ? (
                        <p className="mt-3 text-sm leading-6 text-foreground">
                          {finding.recommendation}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  description="The first analysis run will populate this stack with structured findings and recommended follow-up."
                  icon={<SparkIcon className="h-5 w-5" />}
                  title="No findings yet"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recommended actions</CardTitle>
              <CardDescription>
                Plant-level actions will become more precise as timeline density
                increases.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {actionItems.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4"
                >
                  <CheckCircleIcon className="mt-0.5 h-4 w-4 text-accent" />
                  <p className="text-sm leading-6 text-foreground">{item}</p>
                </div>
              ))}
              <Link
                className={buttonStyles({
                  className: "w-full justify-center",
                  variant: "surface",
                })}
                href="/assistant"
              >
                Translate this into a checklist
                <ArrowUpRightIcon className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>
      <LiveAnalysisRefresher growIds={[context.growId]} />
    </main>
  );
}
