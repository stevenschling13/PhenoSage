import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getServerUser } from "@/lib/server/auth";
import { fetchGrowDetail } from "@/lib/server/workspace-records";
import { EditGrowForm, type EditGrowFormInitial } from "./edit-form";

export const metadata: Metadata = { title: "Edit grow" };

interface Props {
  params: Promise<{ id: string }>;
}

// Owner-gated edit screen. Non-owners get a clean 404 instead of a
// disabled-but-visible form, which would leak the existence of grows
// they're a viewer/collaborator on without being able to edit. The
// underlying server action also enforces ownership via RLS, so this
// is defence-in-depth.
export default async function EditGrowPage({ params }: Props) {
  const { id } = await params;
  const [user, detail] = await Promise.all([
    getServerUser(),
    fetchGrowDetail(id),
  ]);

  if (!user) {
    redirect(`/auth?next=/grows/${encodeURIComponent(id)}/edit`);
  }
  if (!detail) {
    notFound();
  }
  if (detail.grow.ownerId !== user.id) {
    notFound();
  }

  const { grow } = detail;

  return (
    <main className="app-page">
      <PageHeader
        actions={
          <Link
            className={buttonStyles({ size: "md", variant: "surface" })}
            href={`/grows/${grow.id}`}
          >
            Cancel
          </Link>
        }
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/grows", label: "Grows" },
          { href: `/grows/${grow.id}`, label: grow.name },
          { label: "Edit" },
        ]}
        description="Update the metadata that anchors plants, photos, and assistant context for this grow."
        title={`Edit ${grow.name}`}
      />

      <Card>
        <CardContent>
          <EditGrowForm
            growId={grow.id}
            initial={{
              description: grow.description ?? "",
              lightType:
                (grow.lightType as EditGrowFormInitial["lightType"] | null) ??
                "led",
              medium:
                (grow.medium as EditGrowFormInitial["medium"] | null) ?? "soil",
              name: grow.name,
              stage:
                (grow.stage as EditGrowFormInitial["stage"] | null) ??
                "seedling",
              startDate: grow.startDate ?? "",
              targetHarvestDate: grow.targetHarvestDate ?? "",
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
