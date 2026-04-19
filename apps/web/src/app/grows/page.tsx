import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { LeafIcon, PlusIcon } from "@/components/ui/icons";
import { getServerUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Grows" };
export const dynamic = "force-dynamic";

export default async function GrowsPage() {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/grows");

  return (
    <AppShell user={{ email: user.email ?? user.id }}>
      <Container width="xl" className="space-y-8 py-8 md:py-10">
        <PageHeader
          eyebrow="Workspace"
          title="My grows"
          description="Each grow groups its plants, photos, and findings."
          actions={
            <Button leftIcon={<PlusIcon width={16} height={16} />}>
              New grow
            </Button>
          }
        />

        <EmptyState
          icon={<LeafIcon width={20} height={20} />}
          title="No grows yet"
          description="Create your first grow to start tracking plants, photos, and AI findings."
          action={
            <Button asChild leftIcon={<PlusIcon width={16} height={16} />}>
              <Link href="#">Create your first grow</Link>
            </Button>
          }
        />

        <p className="text-xs text-muted-foreground">
          Grows are loaded server-side via Supabase with row-level security.
        </p>
      </Container>
    </AppShell>
  );
}
