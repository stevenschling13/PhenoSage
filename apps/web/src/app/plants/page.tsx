import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { ImageIcon, PlusIcon } from "@/components/ui/icons";
import { getServerUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Plants" };
export const dynamic = "force-dynamic";

export default async function PlantsIndexPage() {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/plants");

  return (
    <AppShell user={{ email: user.email ?? user.id }}>
      <Container width="xl" className="space-y-8 py-8 md:py-10">
        <PageHeader
          eyebrow="Workspace"
          title="Plants"
          description="Every plant across your grows, with their latest health snapshot."
          actions={
            <Button asChild leftIcon={<PlusIcon width={16} height={16} />}>
              <Link href="/grows">Add a plant</Link>
            </Button>
          }
        />

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
      </Container>
    </AppShell>
  );
}
