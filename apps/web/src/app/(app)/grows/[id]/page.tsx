import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GrowIcon, PlantIcon } from "@/components/icons";
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
import { fetchGrowDetail } from "@/lib/server/workspace-records";
import { ArchiveButton } from "./archive-button";

export const metadata: Metadata = { title: "Grow detail" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    just_created?: string | string[] | undefined;
  }>;
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return value;
}

function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

// The grow detail page is the post-create landing target and the
// canonical place to view a single grow. RLS keeps non-members from
// reading the row — fetchGrowDetail returns null and we 404.
//
// Layout:
//   * Header with the grow name, stage badge, archived badge if set.
//   * "just_created" banner (mirrors /grows registry banner) so the
//     create-grow flow has an obvious confirmation on this page too.
//   * Metadata card (description, medium, light, dates).
//   * Plant list with link to each plant detail page + "Add a plant"
//     CTA preselecting this grow.
//   * Footer with the Archive / Restore action.
export default async function GrowDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const detail = await fetchGrowDetail(id);
  if (!detail) {
    notFound();
  }
  const { grow, plants } = detail;

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const justCreated = firstParam(resolvedSearchParams?.just_created) === "1";

  const activePlants = plants.filter((p) => !p.isArchived);
  const archivedPlants = plants.filter((p) => p.isArchived);

  return (
    <main className="app-page">
      <PageHeader
        actions={
          <>
            <Link
              className={buttonStyles({ size: "md", variant: "surface" })}
              href="/grows"
            >
              Back to registry
            </Link>
            <Link
              className={buttonStyles({ size: "md" })}
              href={`/plants/new?growId=${grow.id}`}
            >
              Add a plant
            </Link>
          </>
        }
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/grows", label: "Grows" },
          { label: grow.name },
        ]}
        description={
          grow.description ??
          "No description yet. Open the chat assistant to fill in medium notes, room constraints, or handoff details."
        }
        eyebrow={
          <div className="flex flex-wrap gap-2">
            <Badge tone="accent">{titleCase(grow.stage)}</Badge>
            {grow.isArchived ? <Badge tone="default">Archived</Badge> : null}
          </div>
        }
        title={grow.name}
      />

      {justCreated ? (
        <div
          aria-live="polite"
          className="rounded-[1.15rem] border border-success/40 bg-success/10 px-4 py-4 text-sm leading-6 text-foreground"
          role="status"
        >
          <p className="font-medium">
            Grow &ldquo;{grow.name}&rdquo; is ready.
          </p>
          <p className="mt-1 text-muted-foreground">
            Next step: add a plant so photo uploads, timelines, and assistant
            context have a home.
          </p>
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>
              {activePlants.length === 0 ? "No plants yet" : "Plants"}
            </CardTitle>
            <CardDescription>
              Plants anchor every photo timeline, finding, and assistant prompt
              for this grow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activePlants.length === 0 ? (
              <EmptyState
                action={
                  <Link
                    className={buttonStyles({})}
                    href={`/plants/new?growId=${grow.id}`}
                  >
                    Add the first plant
                  </Link>
                }
                description="Add a plant to unlock image uploads, timelines, and assistant workflows for this grow."
                icon={<PlantIcon className="h-5 w-5" />}
                title="Add a plant"
              />
            ) : (
              <ul className="space-y-3">
                {activePlants.map((plant) => (
                  <li
                    key={plant.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-3"
                  >
                    <div className="space-y-1">
                      <p className="text-base font-semibold text-foreground">
                        {plant.name}
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {plant.strain ?? "Strain pending"}
                        {plant.batchLabel ? ` · ${plant.batchLabel}` : ""}
                      </p>
                    </div>
                    <Link
                      className={buttonStyles({
                        size: "sm",
                        variant: "surface",
                      })}
                      href={`/plants/${plant.id}`}
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {archivedPlants.length > 0 ? (
              <details className="mt-4 rounded-[1.1rem] border border-border/60 bg-background-subtle/40 px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                  {archivedPlants.length} archived plant
                  {archivedPlants.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {archivedPlants.map((plant) => (
                    <li
                      key={plant.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span>{plant.name}</span>
                      <Link
                        className="text-accent underline"
                        href={`/plants/${plant.id}`}
                      >
                        Open
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Grow metadata</CardTitle>
            <CardDescription>
              The structural details that anchor every analysis and alert.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Stage</dt>
              <dd className="text-foreground">{titleCase(grow.stage)}</dd>

              <dt className="text-muted-foreground">Medium</dt>
              <dd className="text-foreground">{titleCase(grow.medium)}</dd>

              <dt className="text-muted-foreground">Light</dt>
              <dd className="text-foreground">{titleCase(grow.lightType)}</dd>

              <dt className="text-muted-foreground">Start</dt>
              <dd className="text-foreground">{formatDate(grow.startDate)}</dd>

              <dt className="text-muted-foreground">Target harvest</dt>
              <dd className="text-foreground">
                {formatDate(grow.targetHarvestDate)}
              </dd>

              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-foreground">
                {grow.isArchived ? "Archived" : "Active"}
              </dd>
            </dl>
            <div className="mt-5 border-t border-border/60 pt-4">
              <ArchiveButton growId={grow.id} isArchived={grow.isArchived} />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {grow.isArchived
                  ? "Restoring a grow brings it back to active state. If another active grow already uses this name, rename one first."
                  : "Archiving keeps history but hides the grow from active workflows. You can restore it anytime."}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What this grow unlocks</CardTitle>
            <CardDescription>
              Every workflow in PhenoSage is anchored to a grow record.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-3">
              Photo uploads, timelines, and AI-generated findings attach to
              plants under this grow.
            </div>
            <div className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-3">
              Assistant conversations can be scoped here for grounded
              recommendations.
            </div>
            <div className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-3">
              Daily alert digests roll up findings by grow.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>The fastest paths from here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              className={buttonStyles({ size: "md", variant: "surface" })}
              href={`/plants/new?growId=${grow.id}`}
            >
              <PlantIcon className="h-4 w-4" />
              Add a plant
            </Link>
            <Link
              className={buttonStyles({ size: "md", variant: "surface" })}
              href="/assistant"
            >
              <GrowIcon className="h-4 w-4" />
              Open the assistant
            </Link>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
