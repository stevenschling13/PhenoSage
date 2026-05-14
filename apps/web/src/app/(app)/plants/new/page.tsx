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
import { listAccessibleGrows } from "@/lib/server/workspace-records";
import { PlantForm } from "./plant-form";

export const metadata: Metadata = { title: "Add Plant" };

interface Props {
  searchParams?: Promise<{
    growId?: string | string[] | undefined;
    just_created?: string | string[] | undefined;
  }>;
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function NewPlantPage({ searchParams }: Props) {
  const grows = await listAccessibleGrows();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedGrowIdValue = firstParam(resolvedSearchParams?.growId);
  const justCreated = firstParam(resolvedSearchParams?.just_created) === "1";
  const matchedGrow = grows.find((grow) => grow.id === requestedGrowIdValue);
  const defaultGrowId = matchedGrow?.id ?? grows[0]?.id ?? "";
  const justCreatedGrowName = justCreated ? matchedGrow?.name : undefined;

  return (
    <main className="app-page">
      <PageHeader
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/plants", label: "Plants" },
          { label: "Add plant" },
        ]}
        description="Attach a plant to an existing grow so image uploads, timeline entries, and assistant context have a real home."
        eyebrow={<Badge tone="accent">Create plant</Badge>}
        title="Add a plant"
      />

      {justCreatedGrowName ? (
        <div
          aria-live="polite"
          className="rounded-[1.15rem] border border-success/40 bg-success/10 px-4 py-4 text-sm leading-6 text-foreground"
          role="status"
        >
          <p className="font-medium">
            Grow &ldquo;{justCreatedGrowName}&rdquo; is ready.
          </p>
          <p className="mt-1 text-muted-foreground">
            Add the first plant below to start tracking image history,
            timelines, and assistant context — or{" "}
            <Link className="underline" href="/grows">
              skip back to the grow registry
            </Link>
            .
          </p>
        </div>
      ) : null}

      {grows.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              action={
                <Link className={buttonStyles({})} href="/grows/new">
                  Create grow
                </Link>
              }
              description="Plants must belong to a grow. Create the first grow record before trying to add plants or upload photos."
              icon={<PlantIcon className="h-5 w-5" />}
              title="Create a grow first"
            />
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.8fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Plant intake</CardTitle>
              <CardDescription>
                A minimal plant record is enough to unlock photo uploads,
                timelines, and grounded assistant workflows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PlantForm defaultGrowId={defaultGrowId} grows={grows} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What happens next</CardTitle>
              <CardDescription>
                The plant detail page becomes the single place to upload images
                and review the resulting timeline.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="rounded-[1.1rem] border border-border/70 bg-background-subtle/60 px-4 py-4">
                Uploads use a server-issued Supabase Storage signed URL instead
                of sending files through the web server.
              </div>
              <div className="rounded-[1.1rem] border border-border/70 bg-background-subtle/60 px-4 py-4">
                Successful uploads persist to the plant timeline before any AI
                analysis is attempted.
              </div>
              <div className="rounded-[1.1rem] border border-border/70 bg-background-subtle/60 px-4 py-4">
                If analysis is unavailable, the upload still lands and the page
                says so explicitly.
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </main>
  );
}
