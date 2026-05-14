import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { GrowForm } from "./grow-form";

export const metadata: Metadata = { title: "New Grow" };

export default function NewGrowPage() {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="app-page">
      <PageHeader
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/grows", label: "Grows" },
          { label: "New grow" },
        ]}
        description="Set up the grow record — name, stage, medium, light — then we'll take you straight to adding the first plant."
        eyebrow={<Badge tone="accent">Create grow</Badge>}
        title="New grow"
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Grow intake</CardTitle>
            <CardDescription>
              Capture the minimum metadata needed to make downstream analysis
              and timeline history meaningful on day one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GrowForm initialStartDate={today} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What gets unlocked next</CardTitle>
            <CardDescription>
              The grow record turns the rest of the authenticated workflow into
              a real operating loop instead of disconnected screens.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="rounded-[1.1rem] border border-border/70 bg-background-subtle/60 px-4 py-4">
              Plants can be attached to a specific room, tent, or program
              instead of floating without context.
            </div>
            <div className="rounded-[1.1rem] border border-border/70 bg-background-subtle/60 px-4 py-4">
              Photo uploads and timeline entries inherit stage, medium, and
              light data immediately.
            </div>
            <div className="rounded-[1.1rem] border border-border/70 bg-background-subtle/60 px-4 py-4">
              The dashboard can summarize actual workspace activity instead of
              empty-state scaffolding.
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
