import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FindingResolutionControls } from "@/components/finding-resolution-controls";
import { CheckCircleIcon, SparkIcon } from "@/components/icons";
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
import { getServerSession } from "@/lib/server/auth";
import { getTriageInbox } from "@/lib/server/triage";

export const metadata: Metadata = { title: "Triage" };

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function TriagePage() {
  // Unauthed users get sent back to /auth — the rest of the (app) group
  // already enforces this, but we double-check so a missing session never
  // hits the user-scoped Supabase client below.
  const session = await getServerSession();
  if (!session) {
    redirect("/auth?next=/triage");
  }

  const { findings, tasks } = await getTriageInbox();
  const totalCount = findings.length + tasks.length;

  return (
    <main className="app-page">
      <PageHeader
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { label: "Triage" },
        ]}
        description="Pending findings and open work items across every grow you have access to. Confirm, reject, or mark false positive inline — the spawned task auto-dismisses on reject/false-positive."
        eyebrow={<Badge tone="accent">Triage queue</Badge>}
        title="What needs your attention"
      />

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          detail={
            findings.length === 0
              ? "Every signal has been triaged."
              : "Confirm or reject below."
          }
          icon={<SparkIcon className="h-5 w-5" />}
          label="Findings awaiting review"
          tone={findings.length === 0 ? "accent" : "warning"}
          value={String(findings.length)}
        />
        <StatCard
          detail={
            tasks.length === 0
              ? "No open work items."
              : "Tasks spawned from findings or grower input."
          }
          icon={<CheckCircleIcon className="h-5 w-5" />}
          label="Open tasks"
          tone={tasks.length === 0 ? "accent" : "warning"}
          value={String(tasks.length)}
        />
        <StatCard
          detail="Combined inbox across every accessible grow."
          icon={<SparkIcon className="h-5 w-5" />}
          label="Total items"
          tone="accent"
          value={String(totalCount)}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Findings awaiting review</CardTitle>
          <CardDescription>
            Severity-ranked. Click through to the plant for full context, or
            triage in place.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {findings.length === 0 ? (
            <EmptyState
              description="Every pending finding has been triaged. Upload a new photo or log an observation to keep the loop going."
              icon={<SparkIcon className="h-5 w-5" />}
              title="Inbox zero"
            />
          ) : (
            <ol className="space-y-4">
              {findings.map((finding) => (
                <li
                  key={`finding-${finding.id}`}
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
                    <Link
                      className="text-xs uppercase tracking-[0.14em] text-accent hover:underline"
                      href={`/plants/${finding.plantId}`}
                    >
                      {finding.growName} → {finding.plantName}
                    </Link>
                    <time
                      className="ml-auto text-xs text-muted-foreground"
                      dateTime={finding.createdAt}
                    >
                      {formatDateTime(finding.createdAt)}
                    </time>
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
                  <FindingResolutionControls
                    findingId={finding.id}
                    initialState={finding.resolutionState}
                    plantId={finding.plantId}
                  />
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open tasks</CardTitle>
          <CardDescription>
            Priority-ranked. Use the plant passport to mark progress or complete
            a task.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <EmptyState
              description="No open or in-progress tasks across your grows. Confirmed AI findings will land here when they spawn work."
              icon={<CheckCircleIcon className="h-5 w-5" />}
              title="Inbox zero"
            />
          ) : (
            <ol className="space-y-4">
              {tasks.map((task) => (
                <li
                  key={`task-${task.id}`}
                  className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        task.priority === "urgent"
                          ? "danger"
                          : task.priority === "high"
                            ? "warning"
                            : "accent"
                      }
                    >
                      {task.priority} priority
                    </Badge>
                    <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                      {task.status}
                    </span>
                    {task.plantId ? (
                      <Link
                        className="text-xs uppercase tracking-[0.14em] text-accent hover:underline"
                        href={`/plants/${task.plantId}`}
                      >
                        {task.growName} → {task.plantName}
                      </Link>
                    ) : (
                      <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        {task.growName}
                      </span>
                    )}
                    {task.findingId ? (
                      <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        from AI finding
                      </span>
                    ) : null}
                    <time
                      className="ml-auto text-xs text-muted-foreground"
                      dateTime={task.createdAt}
                    >
                      {formatDateTime(task.createdAt)}
                    </time>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {task.title}
                  </p>
                  {task.description ? (
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {task.description}
                    </p>
                  ) : null}
                  {task.dueAt ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Due {formatDateTime(task.dueAt)}
                    </p>
                  ) : null}
                  {task.plantId ? (
                    <div className="mt-3">
                      <Link
                        className={buttonStyles({
                          size: "sm",
                          variant: "surface",
                        })}
                        href={`/plants/${task.plantId}/passport`}
                      >
                        Open passport
                      </Link>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
