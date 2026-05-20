import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { GrowTask } from "@phenosage/shared";
import { FindingResolutionControls } from "@/components/finding-resolution-controls";
import {
  CheckCircleIcon,
  PlantIcon,
  SparkIcon,
  TimelineIcon,
} from "@/components/icons";
import { SignedImage } from "@/components/signed-image";
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
import { getAuthorizedPlantContext } from "@/lib/server/plant-access";
import { getPlantPassport } from "@/lib/server/plants";
import { getStorageClient } from "@/lib/server/storage";

export const metadata: Metadata = { title: "Plant Passport" };

interface Props {
  params: Promise<{ plantId: string }>;
}

// Plant IDs are persisted as Postgres UUIDs. Reject malformed inputs at the
// edge so we don't waste a Supabase round trip on accidental URL typos.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function taskTone(
  task: GrowTask,
): "default" | "accent" | "success" | "warning" | "danger" {
  if (task.status === "done") return "success";
  if (task.status === "dismissed") return "default";
  if (task.priority === "urgent") return "danger";
  if (task.priority === "high") return "warning";
  return "accent";
}

export default async function PlantPassportPage({ params }: Props) {
  const { plantId } = await params;
  if (!UUID_RE.test(plantId)) {
    notFound();
  }
  const context = await getAuthorizedPlantContext(plantId);
  if (!context) {
    notFound();
  }

  const passport = await getPlantPassport(plantId);
  if (!passport) {
    notFound();
  }

  // Pre-sign every image URL in a single fan-out so the page renders
  // without a waterfall. 10-minute TTL matches the plant detail page;
  // the SignedImage component re-signs once on the first 403.
  const storage = getStorageClient().from("plant-images");
  const imageSignings = await Promise.all(
    passport.items
      .filter((item) => item.type === "image")
      .map(async (item) => {
        const { data } = await storage.createSignedUrl(
          item.storagePath,
          60 * 10,
        );
        return [item.id, data?.signedUrl ?? null] as const;
      }),
  );
  const signedByImageId = new Map(imageSignings);

  const shortId = context.plantId.slice(0, 8).toUpperCase();
  const hasAnyActivity = passport.items.length > 0;

  return (
    <main className="app-page">
      <PageHeader
        actions={
          <Link
            className={buttonStyles({ size: "md", variant: "surface" })}
            href={`/plants/${plantId}`}
          >
            Back to plant
          </Link>
        }
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/grows", label: "Grows" },
          { href: `/plants/${plantId}`, label: passport.plantName },
          { label: "Passport" },
        ]}
        description="Every capture, observation, and action on one chronological feed — the operating record of this plant."
        eyebrow={<Badge tone="accent">Plant passport</Badge>}
        title={`${passport.plantName || `Plant ${shortId}`} — passport`}
      />

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          detail={
            passport.pendingFindingCount === 0
              ? "Every AI signal has been triaged."
              : "Open the items below and confirm, reject, or mark false positive."
          }
          icon={<SparkIcon className="h-5 w-5" />}
          label="Findings awaiting review"
          tone={passport.pendingFindingCount === 0 ? "accent" : "warning"}
          value={String(passport.pendingFindingCount)}
        />
        <StatCard
          detail={
            passport.openTaskCount === 0
              ? "No tasks blocking the next cycle."
              : "Work items spawned from findings or grower input."
          }
          icon={<CheckCircleIcon className="h-5 w-5" />}
          label="Open tasks"
          tone={passport.openTaskCount === 0 ? "accent" : "warning"}
          value={String(passport.openTaskCount)}
        />
        <StatCard
          detail="Total entries across images, observations, and tasks."
          icon={<TimelineIcon className="h-5 w-5" />}
          label="Timeline entries"
          tone="accent"
          value={String(passport.items.length)}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Chronological feed</CardTitle>
          <CardDescription>
            Newest first. Confirm or reject AI findings inline — the
            corresponding task auto-dismisses when you reject or mark a finding
            as false positive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasAnyActivity ? (
            <ol className="space-y-5">
              {passport.items.map((item) => {
                if (item.type === "image") {
                  const signedUrl = signedByImageId.get(item.id);
                  return (
                    <li
                      key={`image-${item.id}`}
                      className="rounded-[1.25rem] border border-border/70 bg-background-subtle/50 p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Badge tone="accent">Image</Badge>
                          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            {item.source}
                          </span>
                        </div>
                        <time
                          className="text-xs text-muted-foreground"
                          dateTime={item.takenAt}
                        >
                          {formatDateTime(item.takenAt)}
                        </time>
                      </div>
                      {signedUrl ? (
                        <div className="mt-4 overflow-hidden rounded-[1.15rem] border border-border/70">
                          <SignedImage
                            alt={`Plant capture from ${formatDateTime(item.takenAt)}`}
                            className="h-auto w-full"
                            imageId={item.id}
                            initialSrc={signedUrl}
                            plantId={plantId}
                          />
                        </div>
                      ) : null}
                      {item.notes ? (
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                          {item.notes}
                        </p>
                      ) : null}
                      {item.analysis ? (
                        <p className="mt-3 text-sm leading-6 text-foreground">
                          <strong className="font-semibold">
                            Analysis ({item.analysis.overallHealthScore}/100):
                          </strong>{" "}
                          {item.analysis.summary}
                        </p>
                      ) : null}
                      {item.findings.length > 0 ? (
                        <div className="mt-4 space-y-3">
                          {item.findings.map((finding) => (
                            <div
                              className="rounded-[1.15rem] border border-border/70 bg-surface px-4 py-4"
                              key={
                                finding.id ??
                                `${finding.title}-${finding.description}`
                              }
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
                                {finding.source === "user_reported" ? (
                                  <Badge tone="info">User reported</Badge>
                                ) : null}
                              </div>
                              <p className="mt-2 text-sm font-semibold text-foreground">
                                {finding.title}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                {finding.description}
                              </p>
                              {finding.recommendation ? (
                                <p className="mt-2 text-sm leading-6 text-foreground">
                                  {finding.recommendation}
                                </p>
                              ) : null}
                              {finding.id && finding.resolutionState ? (
                                <FindingResolutionControls
                                  findingId={finding.id}
                                  initialState={finding.resolutionState}
                                  plantId={plantId}
                                />
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                }
                if (item.type === "observation") {
                  return (
                    <li
                      key={`obs-${item.id}`}
                      className="rounded-[1.25rem] border border-border/70 bg-background-subtle/50 p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Badge tone="accent">Observation</Badge>
                        <time
                          className="text-xs text-muted-foreground"
                          dateTime={item.observedAt}
                        >
                          {formatDateTime(item.observedAt)}
                        </time>
                      </div>
                      {item.heightCm !== undefined ? (
                        <p className="mt-3 text-sm leading-6 text-foreground">
                          Height: <strong>{item.heightCm} cm</strong>
                        </p>
                      ) : null}
                      {item.notes ? (
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {item.notes}
                        </p>
                      ) : null}
                    </li>
                  );
                }
                const task = item.task;
                return (
                  <li
                    key={`task-${task.id}`}
                    className="rounded-[1.25rem] border border-border/70 bg-background-subtle/50 p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={taskTone(task)}>
                          Task · {task.status}
                        </Badge>
                        <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                          {task.priority} priority
                        </span>
                        {task.findingId ? (
                          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            from AI finding
                          </span>
                        ) : null}
                      </div>
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={task.createdAt}
                      >
                        {formatDateTime(task.createdAt)}
                      </time>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-foreground">
                      {task.title}
                    </p>
                    {task.description ? (
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {task.description}
                      </p>
                    ) : null}
                    {task.dueAt ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Due {formatDateTime(task.dueAt)}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState
              description="Upload a baseline image or add an observation to start the plant's passport."
              icon={<PlantIcon className="h-5 w-5" />}
              title="No activity yet"
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
