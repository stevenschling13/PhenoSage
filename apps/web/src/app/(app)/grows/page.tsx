import type { Metadata } from "next";
import {
  ActivityIcon,
  GrowIcon,
  PlantIcon,
  ShieldIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Grows" };

export default function GrowsPage() {
  return (
    <main className="app-page">
      <PageHeader
        actions={<Button disabled>New grow</Button>}
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { label: "Grows" },
        ]}
        description="Organize facilities, tents, or cultivation programs into structured grow records that anchor every plant, image, event, and assistant conversation."
        eyebrow={<Badge tone="accent">Workspace map</Badge>}
        title="Grow registry"
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>No active grows yet</CardTitle>
            <CardDescription>
              The grow registry will become the backbone for timeline access,
              role-based access, and grow-aware assistant scope.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              action={<Button disabled>Start grow intake</Button>}
              description="Create the first grow once the persistence flow is connected. Until then, PhenoSage keeps the structure visible so the operating model is clear."
              icon={<GrowIcon className="h-5 w-5" />}
              title="Grow objects are not seeded yet"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Grow intake blueprint</CardTitle>
            <CardDescription>
              The first create flow should capture enough metadata to make
              future analysis useful.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              "Grow name and optional facility description",
              "Current stage, medium, and light type",
              "Target harvest date and start date",
              "Membership roles for owner, collaborator, and viewer access",
            ].map((item) => (
              <div
                key={item}
                className="rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4 text-sm leading-6 text-foreground"
              >
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Why grows matter</CardTitle>
            <CardDescription>
              Every serious plant workflow in PhenoSage is anchored to the grow
              record.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="rounded-[1.2rem] border border-border/70 bg-background-subtle/70 p-4">
              Assistant scope can be narrowed to the right room or program.
            </div>
            <div className="rounded-[1.2rem] border border-border/70 bg-background-subtle/70 p-4">
              Timeline queries can respect role-based access rules.
            </div>
            <div className="rounded-[1.2rem] border border-border/70 bg-background-subtle/70 p-4">
              Alerts can speak to stage and harvest planning, not generic
              reminders.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Planned occupancy view</CardTitle>
            <CardDescription>
              Once plants exist, this area will summarize plant count, stage
              mix, and risk density.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              description="No plants can be attached until the first grow exists. The future grid will summarize plant count, latest health score, and high-severity findings per grow."
              icon={<PlantIcon className="h-5 w-5" />}
              title="Plant occupancy not available"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security posture</CardTitle>
            <CardDescription>
              Grow records are where role-aware collaboration should begin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="flex items-start gap-3 rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4">
              <ShieldIcon className="mt-0.5 h-4 w-4 text-accent" />
              Grow members will define owner, collaborator, and viewer access.
            </div>
            <div className="flex items-start gap-3 rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4">
              <ActivityIcon className="mt-0.5 h-4 w-4 text-accent" />
              Timeline and finding queries can inherit the same authorization
              model.
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
