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
import { ImageIcon, PlusIcon } from "@/components/ui/icons";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Plants" };
export const dynamic = "force-dynamic";

interface PlantRow {
  id: string;
  name: string;
  strain: string | null;
  batch_label: string | null;
  grow_id: string;
  grows: { name: string } | null;
}

interface Props {
  searchParams: Promise<{ grow?: string }>;
}

export default async function PlantsIndexPage({ searchParams }: Props) {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/plants");

  const { grow: growFilter } = await searchParams;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("plants")
    .select("id, name, strain, batch_label, grow_id, grows(name)")
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (growFilter) query = query.eq("grow_id", growFilter);

  const { data, error } = await query;

  if (error) {
    console.error("[plants] list query failed", error);
  }

  // Supabase returns the joined relation as an object when there's one parent.
  const plants: PlantRow[] = ((data ?? []) as unknown as PlantRow[]) ?? [];

  return (
    <AppShell user={{ email: user.email ?? user.id }}>
      <Container width="xl" className="space-y-8 py-8 md:py-10">
        <PageHeader
          eyebrow="Workspace"
          title="Plants"
          description={
            growFilter
              ? "Plants filtered to one grow."
              : "Every plant across your grows, with their latest health snapshot."
          }
          actions={
            <Button asChild leftIcon={<PlusIcon width={16} height={16} />}>
              <Link href="/grows">Add a plant</Link>
            </Button>
          }
        />

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            Couldn&apos;t load plants. Refresh to try again.
          </div>
        )}

        {plants.length === 0 && !error ? (
          <EmptyState
            icon={<ImageIcon width={20} height={20} />}
            title="No plants yet"
            description="Plants live inside grows. Create a grow to add your first plant."
            action={
              <Button
                asChild
                size="sm"
                leftIcon={<PlusIcon width={14} height={14} />}
              >
                <Link href="/grows">Go to grows</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plants.map((plant) => (
              <Link
                key={plant.id}
                href={`/plants/${plant.id}`}
                className="group block focus-visible:outline-none"
              >
                <Card className="transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-elevation-2 group-focus-visible:ring-2 group-focus-visible:ring-ring">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate">{plant.name}</CardTitle>
                        {plant.grows?.name && (
                          <CardDescription className="mt-1 truncate">
                            in {plant.grows.name}
                          </CardDescription>
                        )}
                      </div>
                      {plant.batch_label && (
                        <Badge variant="outline" className="font-mono">
                          {plant.batch_label}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {plant.strain ?? "Strain not set"}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Container>
    </AppShell>
  );
}
