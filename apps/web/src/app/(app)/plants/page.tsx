import type { Metadata } from "next";
import Link from "next/link";
import { PlantIcon } from "@/components/icons";
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
import {
  listAccessibleGrows,
  listAccessiblePlants,
} from "@/lib/server/workspace-records";

export const metadata: Metadata = { title: "Plants" };

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export default async function PlantsPage() {
  const [grows, plants] = await Promise.all([
    listAccessibleGrows(),
    listAccessiblePlants(),
  ]);

  const hasGrows = grows.length > 0;
  const hasPlants = plants.length > 0;

  return (
    <main className="app-page">
      <PageHeader
        actions={
          hasGrows ? (
            <Link className={buttonStyles({})} href="/plants/new">
              Add a plant
            </Link>
          ) : (
            <Link className={buttonStyles({})} href="/grows/new">
              Create grow
            </Link>
          )
        }
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { label: "Plants" },
        ]}
        description="Review every active plant in the workspace, open its timeline, and route new captures into the correct grow context."
        eyebrow={<Badge tone="accent">Plant registry</Badge>}
        title="Plants"
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>
              {hasPlants ? "Active plants" : "No plants yet"}
            </CardTitle>
            <CardDescription>
              Plant records keep uploads, observations, and findings attached to
              the correct grow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasPlants ? (
              <div className="space-y-3">
                {plants.map((plant) => (
                  <div
                    key={plant.id}
                    className="rounded-[1.15rem] border border-border/70 bg-background-subtle/60 px-4 py-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-semibold text-foreground">
                            {plant.name}
                          </p>
                          {plant.grow?.stage ? (
                            <Badge tone="accent">
                              {plant.grow.stage.replaceAll("_", " ")}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {plant.grow?.name ?? "Unknown grow"}
                          {plant.strain ? ` · ${plant.strain}` : ""}
                          {plant.batchLabel ? ` · ${plant.batchLabel}` : ""}
                        </p>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Updated {formatDateLabel(plant.updatedAt)}
                        </p>
                      </div>
                      <Link
                        className={buttonStyles({
                          size: "sm",
                          variant: "surface",
                        })}
                        href={`/plants/${plant.id}`}
                      >
                        Open timeline
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                action={
                  hasGrows ? (
                    <Link className={buttonStyles({})} href="/plants/new">
                      Add a plant
                    </Link>
                  ) : (
                    <Link className={buttonStyles({})} href="/grows/new">
                      Create grow
                    </Link>
                  )
                }
                description={
                  hasGrows
                    ? "You already have a grow. Add the first plant to unlock photo uploads, timelines, and analysis."
                    : "Create a grow first so the first plant has a real operating context."
                }
                icon={<PlantIcon className="h-5 w-5" />}
                title={hasGrows ? "Add the first plant" : "Plants need a grow"}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Core loop status</CardTitle>
            <CardDescription>
              The plant record is where upload, timeline, and assistant flows
              converge.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="rounded-[1.1rem] border border-border/70 bg-background-subtle/60 px-4 py-4">
              Every plant can open a dedicated timeline page with the latest
              images and observations.
            </div>
            <div className="rounded-[1.1rem] border border-border/70 bg-background-subtle/60 px-4 py-4">
              Uploads persist to Supabase Storage through signed URLs before the
              timeline refreshes.
            </div>
            <div className="rounded-[1.1rem] border border-border/70 bg-background-subtle/60 px-4 py-4">
              Assistant conversations can reference persisted findings from the
              authenticated workspace today.
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
