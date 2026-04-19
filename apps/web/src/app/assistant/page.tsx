import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { ChatIcon, SendIcon, SparklesIcon } from "@/components/ui/icons";
import { getServerUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

const SUGGESTIONS = [
  "What's the most likely cause of yellowing on lower leaves?",
  "When should I switch this grow to flower?",
  "Summarize what changed in the last 7 days.",
];

export default async function AssistantPage() {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/assistant");

  return (
    <AppShell user={{ email: user.email ?? user.id }}>
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        {/* Page header strip */}
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

        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-background">
          <Container width="lg" className="py-8">
            <div className="space-y-6">
              {/* AI welcome bubble */}
              <div className="flex gap-3 animate-fade-in-up">
                <div
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
                >
                  AI
                </div>
                <Card className="max-w-xl">
                  <CardContent className="p-4 text-sm leading-relaxed">
                    Hi — I&apos;m your grow copilot. I can see your plants,
                    timeline, and observations. Ask me anything about your grow,
                    or pick a starter below.
                  </CardContent>
                </Card>
              </div>

              {/* Suggestions */}
              <div className="ml-12 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled
                    className="cursor-not-allowed rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-70"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </Container>
        </div>

        {/* Composer */}
        <div className="border-t border-border bg-card">
          <Container width="lg" className="py-4">
            <form
              className="flex items-end gap-2 rounded-lg border border-input bg-background p-2 shadow-elevation-1 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"
              aria-label="Send message"
            >
              <label htmlFor="composer" className="sr-only">
                Ask the copilot
              </label>
              <textarea
                id="composer"
                rows={1}
                placeholder="Ask about your grow…  (Enter to send, Shift+Enter for newline)"
                disabled
                className="max-h-32 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              <Button
                type="submit"
                size="md"
                disabled
                rightIcon={<SendIcon width={14} height={14} />}
              >
                Send
              </Button>
            </form>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Chat is wiring up to /api/chat — coming soon.
            </p>
          </Container>
        </div>
      </div>
    </AppShell>
  );
}
