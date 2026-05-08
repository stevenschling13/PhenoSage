import type { Metadata } from "next";
import Link from "next/link";
import {
  ActivityIcon,
  GrowIcon,
  PlantIcon,
  ShieldIcon,
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
import { getWorkspaceOverview } from "@/lib/server/workspace-overview";

export const metadata: Metadata = { title: "Grows" };

export default async function GrowsPage() {
  const overview = await getWorkspaceOverview();
  const hasGrows = overview.grows.length > 0;

  return (
    <main className="app-page">
      <PageHeader
        actions={
          <>
            <Link
              className={buttonStyles({ size: "md", variant: "surface" })}
              href="/plants"
            >
              All plants
            </Link>
            <Link className={buttonStyles({ size: "md" })} href="/grows/new">
              New grow
            </Link>
          </>
        }
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { label: "Grows" },
        ]}
        description="Organize facilities, tents, or cultivation programs into structured grow records that anchor every plant, image, event, and assistant conversation."
        eyebrow={<Badge tone="accent">Workspace map</Badge>}
        title="Grow registry"
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>
              {hasGrows ? "Active grows" : "No active grows yet"}
            </CardTitle>
            <CardDescription>
              The grow registry should feel like an operating map, not a dead
              list.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasGrows ? (
              <div className="space-y-3">
                {overview.grows.map((grow) => (
                  <div
                    key={grow.id}
                    className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-semibold text-foreground">
                            {grow.name}
                          </p>
                          <Badge tone="accent">
                            {grow.stage ?? "stage pending"}
                          </Badge>
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {grow.plantCount} plants · {grow.imageCount} captures
                          · {grow.openFindingCount} open findings
                        </p>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {grow.medium ?? "medium pending"} ·{" "}
                          {grow.lightType ?? "light profile pending"}
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
                          Open {grow.primaryPlantName ?? "plant"}
                        </Link>
                      ) : (
                        <Link
                          className={buttonStyles({
                            size: "sm",
                            variant: "surface",
                          })}
                          href={`/plants/new?growId=${grow.id}`}
                        >
                          Add plant
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                action={
                  <Link className={buttonStyles({})} href="/grows/new">
                    Start grow intake
                  </Link>
                }
                description="Create the first grow to unlock plant records, signed uploads, timelines, and grounded assistant workflows."
                icon={<GrowIcon className="h-5 w-5" />}
                title="No grows yet"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Grow intake blueprint</CardTitle>
            <CardDescription>
              The first create flow should capture enough metadata to make
              future analysis useful.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              "Grow name and optional facility description",
              "Current stage, medium, and light type",
              "Target harvest date and start date",
              "Membership roles for owner, collaborator, and viewer access",
            ].map((item) => (
              <div
                key={item}
                className="rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4 text-sm leading-6 text-foreground"
              >
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Why grows matter</CardTitle>
            <CardDescription>
              Every serious plant workflow in PhenoSage is anchored to the grow
              record.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="rounded-[1.2rem] border border-border/70 bg-background-subtle/70 p-4">
              Assistant scope can be narrowed to the right room or program.
            </div>
            <div className="rounded-[1.2rem] border border-border/70 bg-background-subtle/70 p-4">
              Timeline queries can respect role-based access rules.
            </div>
            <div className="rounded-[1.2rem] border border-border/70 bg-background-subtle/70 p-4">
              Alerts can speak to stage and harvest planning, not generic
              reminders.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current occupancy view</CardTitle>
            <CardDescription>
              A quick read on whether each grow already has enough structure to
              support meaningful analysis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasGrows ? (
              <div className="space-y-3">
                {overview.grows.slice(0, 4).map((grow) => (
                  <div
                    key={grow.id}
                    className="flex items-start gap-3 rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-4"
                  >
                    <PlantIcon className="mt-0.5 h-4 w-4 text-accent" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        {grow.name}
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {grow.plantCount === 0
                          ? "No plants yet. Add one before expecting image history or findings."
                          : `${grow.plantCount} plants are available for image history and assistant context.`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                description="No plants can be attached until the first grow exists. The future grid will summarize plant count, latest health score, and high-severity findings per grow."
                icon={<PlantIcon className="h-5 w-5" />}
                title="Plant occupancy not available"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security posture</CardTitle>
            <CardDescription>
              Grow records are where role-aware collaboration should begin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="flex items-start gap-3 rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4">
              <ShieldIcon className="mt-0.5 h-4 w-4 text-accent" />
              Grow members will define owner, collaborator, and viewer access.
            </div>
            <div className="flex items-start gap-3 rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4">
              <ActivityIcon className="mt-0.5 h-4 w-4 text-accent" />
              Timeline and finding queries can inherit the same authorization
              model.
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
