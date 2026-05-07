import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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
import { ArrowRightIcon, LeafIcon } from "@/components/ui/icons";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";
import { NewGrowForm } from "./new-grow-form";

export const metadata: Metadata = { title: "Grows" };
export const dynamic = "force-dynamic";

interface GrowRow {
  id: string;
  name: string;
  description: string | null;
  stage: string;
  start_date: string;
  is_archived: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  germination: "Germination",
  seedling: "Seedling",
  vegetative: "Vegetative",
  pre_flower: "Pre-flower",
  flower: "Flower",
  late_flower: "Late flower",
  harvest: "Harvest",
  dry_cure: "Dry / cure",
};

function stageVariant(
  stage: string,
): "secondary" | "info" | "warning" | "success" {
  if (stage === "harvest" || stage === "dry_cure") return "success";
  if (stage === "flower" || stage === "late_flower") return "warning";
  if (stage === "vegetative" || stage === "pre_flower") return "info";
  return "secondary";
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

export default async function GrowsPage() {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/grows");

  const supabase = await createSupabaseServerClient();
  const { data: grows, error } = await supabase
    .from("grows")
    .select("id, name, description, stage, start_date, is_archived")
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[grows] list query failed", error);
  }
  const rows = ((grows ?? []) as GrowRow[]) ?? [];

  return (
    <AppShell user={{ email: user.email ?? user.id }}>
      <Container width="xl" className="space-y-8 py-8 md:py-10">
        <PageHeader
          eyebrow="Workspace"
          title="My grows"
          description="Each grow groups its plants, photos, and findings."
        />

        <NewGrowForm />

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            Couldn&apos;t load grows. Refresh to try again.
          </div>
        )}

        {rows.length === 0 && !error ? (
          <EmptyState
            icon={<LeafIcon width={20} height={20} />}
            title="No grows yet"
            description="Create your first grow to start tracking plants, photos, and AI findings."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((grow) => (
              <Card
                key={grow.id}
                className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elevation-2"
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{grow.name}</CardTitle>
                      <CardDescription className="mt-1 truncate">
                        Started {formatDate(grow.start_date)}
                      </CardDescription>
                    </div>
                    <Badge variant={stageVariant(grow.stage)}>
                      {STAGE_LABELS[grow.stage] ?? grow.stage}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {grow.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {grow.description}
                    </p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">
                      No description.
                    </p>
                  )}
                  <Link
                    href={`/plants?grow=${grow.id}`}
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    View plants
                    <ArrowRightIcon width={14} height={14} />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Grows are loaded server-side via Supabase with row-level security.
        </p>
      </Container>
    </AppShell>
  );
}
