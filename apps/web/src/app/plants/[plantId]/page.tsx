import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { PageHeader } from "@/components/app-shell/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeftIcon, ImageIcon, ScopeIcon } from "@/components/ui/icons";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";
import { UploadCard } from "./upload-card";

export const metadata: Metadata = { title: "Plant Detail" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ plantId: string }>;
}

interface PlantRow {
  id: string;
  name: string;
  strain: string | null;
  batch_label: string | null;
  notes: string | null;
  grow_id: string;
  grows: { name: string } | null;
}

export default async function PlantPage({ params }: Props) {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/plants");

  const { plantId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: plant } = await supabase
    .from("plants")
    .select("id, name, strain, batch_label, notes, grow_id, grows(name)")
    .eq("id", plantId)
    .maybeSingle();

  // RLS will return null if the user can't access this plant.
  if (!plant) notFound();

  const row = plant as unknown as PlantRow;
  const shortId = row.id.length > 12 ? `${row.id.slice(0, 8)}…` : row.id;

  return (
    <AppShell user={{ email: user.email ?? user.id }}>
      <Container width="xl" className="space-y-6 py-8 md:py-10">
        <nav aria-label="Breadcrumb" className="text-sm">
          <Link
            href="/plants"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon width={14} height={14} />
            Plants
          </Link>
        </nav>

        <PageHeader
          eyebrow={row.grows?.name ?? "Plant"}
          title={row.name}
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono">
                {shortId}
              </Badge>
              {row.strain && <Badge variant="secondary">{row.strain}</Badge>}
              {row.batch_label && (
                <Badge variant="secondary" className="font-mono">
                  {row.batch_label}
                </Badge>
              )}
            </span>
          }
        />

        <div className="grid gap-6 lg:grid-cols-3">
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

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Upload</CardTitle>
                <CardDescription>JPG, PNG, WebP, or HEIC.</CardDescription>
              </CardHeader>
              <CardContent>
                <UploadCard plantId={row.id} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
                <CardDescription>
                  Anything you want to remember.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {row.notes ? (
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {row.notes}
                  </p>
                ) : (
                  <p className="text-sm italic text-muted-foreground">
                    No notes yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </Container>
    </AppShell>
  );
}
