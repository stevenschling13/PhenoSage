import type { Metadata } from "next";
import Link from "next/link";
import {
  AnalysisIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  PlantIcon,
  SparkIcon,
  TimelineIcon,
} from "@/components/icons";
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
import { ImageComparison } from "@/components/image-comparison";

export const metadata: Metadata = { title: "Plant Detail" };

interface Props {
  params: Promise<{ plantId: string }>;
}

export default async function PlantPage({ params }: Props) {
  const { plantId } = await params;
  const shortId = plantId.slice(0, 8).toUpperCase();

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
          { label: `Plant ${shortId}` },
        ]}
        description="Track image history, review the latest analysis, and prepare for future longitudinal comparisons without losing operational context."
        eyebrow={<Badge tone="accent">Plant workspace</Badge>}
        title={`Plant ${shortId}`}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          detail="The first upload becomes the baseline for future drift comparisons."
          icon={<PlantIcon className="h-5 w-5" />}
          label="Baseline status"
          tone="accent"
          value="Not set"
        />
        <StatCard
          detail="Once analysis completes, the latest image score and summary appear here."
          icon={<AnalysisIcon className="h-5 w-5" />}
          label="Latest health score"
          tone="warning"
          value="Pending"
        />
        <StatCard
          detail="Severity-ranked plant findings will accumulate across image sets."
          icon={<SparkIcon className="h-5 w-5" />}
          label="Open findings"
          value="0"
        />
        <StatCard
          detail="Timeline cadence helps the copilot distinguish one-off noise from recurring patterns."
          icon={<TimelineIcon className="h-5 w-5" />}
          label="Image cadence"
          value="No history"
        />
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
              <EmptyState
                description="No photos or manual observations are attached to this plant yet. Start with one baseline image, then capture from the same angle after meaningful environmental or feed changes."
                icon={<TimelineIcon className="h-5 w-5" />}
                title="No timeline entries"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest AI analysis</CardTitle>
              <CardDescription>
                This area is reserved for the freshest summary, health score,
                and severity-ranked findings returned by the analysis pipeline.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-[1.25rem] border border-border/70 bg-background-subtle/70 p-5">
                <p className="text-sm leading-6 text-muted-foreground">
                  Upload a secure image set to trigger the first analysis. Once
                  real data lands, the summary will anchor this page and the
                  findings rail to the right.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  "Summary paragraph with severity context",
                  "Top findings with categories and recurrence notes",
                  "Recommended actions translated into clear operator language",
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-[1.2rem] border border-border/70 bg-surface/70 p-4 text-sm leading-6 text-muted-foreground"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Comparison workspace</CardTitle>
              <CardDescription>
                Prepare for side-by-side review once two or more image sets
                exist.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ImageComparison
                beforeImage="https://images.unsplash.com/photo-1628102491629-778571d893a3?auto=format&fit=crop&w=1200&q=80"
                afterImage="https://images.unsplash.com/photo-1596547609652-9cb5d8d76921?auto=format&fit=crop&w=1200&q=80"
                beforeLabel="5 days ago"
                afterLabel="Current upload"
              />
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
              <EmptyState
                description="The first analysis run will populate this stack with structured findings and recommended follow-up."
                icon={<SparkIcon className="h-5 w-5" />}
                title="No findings yet"
              />
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
              {[
                "Capture one baseline image with stable framing and lighting.",
                "Add notes after irrigation, feed, or major environment changes.",
                "Return after the next meaningful change to establish a comparison pair.",
              ].map((item) => (
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
    </main>
  );
}
