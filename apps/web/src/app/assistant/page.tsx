import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { ChatIcon, SparklesIcon } from "@/components/ui/icons";
import { getServerUser } from "@/lib/server/auth";
import { listAccessibleGrows } from "@/lib/server/workspace-records";
import { AssistantChat, type GrowOption } from "./chat-client";

export const metadata: Metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/assistant");

  const grows = await listAccessibleGrows();
  const growOptions: GrowOption[] = grows.map((g) => ({
    id: g.id,
    name: g.name,
    stage: g.stage,
  }));

  return (
    <AppShell user={{ email: user.email ?? user.id }}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border bg-card">
          <Container
            width="lg"
            className="flex items-center justify-between py-4"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary"
              >
                <ChatIcon width={18} height={18} />
              </span>
              <div>
                <h1 className="text-base font-semibold tracking-tight text-foreground">
                  Grow copilot
                </h1>
                <p className="text-xs text-muted-foreground">
                  Scoped to your grow data — never the open web.
                </p>
              </div>
            </div>
            <Badge variant="info" className="hidden sm:inline-flex">
              <SparklesIcon width={12} height={12} className="mr-1" />
              Context-aware
            </Badge>
          </Container>
        </div>

        <AssistantChat grows={growOptions} />
      </div>
    </AppShell>
  );
}
