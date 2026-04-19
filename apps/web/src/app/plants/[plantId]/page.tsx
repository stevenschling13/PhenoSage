import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ArrowLeftIcon,
  ImageIcon,
  ScopeIcon,
  UploadIcon,
} from "@/components/ui/icons";
import { getServerUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Plant Detail" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ plantId: string }>;
}

export default async function PlantPage({ params }: Props) {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/plants");

  const { plantId } = await params;
  const shortId = plantId.length > 12 ? `${plantId.slice(0, 8)}…` : plantId;

  return (
    <AppShell user={{ email: user.email ?? user.id }}>
      <Container width="xl" className="space-y-6 py-8 md:py-10">
        <nav aria-label="Breadcrumb" className="text-sm">
          <Link
            href="/grows"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon width={14} height={14} />
            Grows
          </Link>
        </nav>

        <PageHeader
          eyebrow="Plant"
          title="Untitled plant"
          description={
            <span className="inline-flex items-center gap-2">
              <Badge variant="outline" className="font-mono">
                {shortId}
              </Badge>
              <span>Track photos, findings, and analyses for this plant.</span>
            </span>
          }
          actions={
            <Button leftIcon={<UploadIcon width={16} height={16} />}>
              Upload photo
            </Button>
          }
        />

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Timeline + analysis */}
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Photo timeline</CardTitle>
                <CardDescription>
                  Chronological feed, newest first.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon={<ImageIcon width={20} height={20} />}
                  title="No photos yet"
                  description="Upload your first shot to begin tracking growth and health."
                  action={
                    <Button
                      size="sm"
                      leftIcon={<UploadIcon width={14} height={14} />}
                    >
                      Upload first photo
                    </Button>
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI analysis</CardTitle>
                <CardDescription>
                  Latest findings and severity-ranked recommendations.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EmptyState
                  icon={<ScopeIcon width={20} height={20} />}
                  title="Nothing to analyze yet"
                  description="Once you upload a photo, the visual doctor runs automatically."
                />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Upload</CardTitle>
                <CardDescription>JPG or PNG, up to 10 MB.</CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  role="button"
                  tabIndex={0}
                  className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-10 text-center transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <UploadIcon
                    width={24}
                    height={24}
                    className="mb-2 text-muted-foreground"
                  />
                  <p className="text-sm font-medium text-foreground">
                    Drag a photo here
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    or click to browse
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Findings</CardTitle>
                <CardDescription>Open issues for this plant.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  No findings yet — your plant looks all clear.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </Container>
    </AppShell>
  );
}
