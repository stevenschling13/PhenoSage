import type { Metadata } from "next";
import {
  BellIcon,
  CheckCircleIcon,
  ShieldIcon,
  SparkIcon,
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
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/server/profile";
import { SettingsProfileForm } from "./settings-profile-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const profile = await getCurrentProfile();

  return (
    <main className="app-page">
      <PageHeader
        breadcrumbs={[
          { href: "/dashboard", label: "Dashboard" },
          { label: "Settings" },
        ]}
        description="Manage identity, workspace posture, and future notification defaults without compromising the private operating boundary."
        eyebrow={<Badge tone="accent">Workspace settings</Badge>}
        title="Settings"
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.9fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Identity and access</CardTitle>
              <CardDescription>
                The authenticated operator identity anchors every private route
                and future audit trail.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SettingsProfileForm
                email={profile?.email ?? "Not available"}
                initialDisplayName={profile?.displayName ?? ""}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notification defaults</CardTitle>
              <CardDescription>
                These toggles reserve space for future daily summaries, issue
                alerts, and reminder preferences.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  copy: "Daily workspace summary at the start of the cultivation day",
                  icon: BellIcon,
                  label: "Daily summary",
                },
                {
                  copy: "High-severity finding alerts when plant analysis flags meaningful risk",
                  icon: SparkIcon,
                  label: "Finding alerts",
                },
                {
                  copy: "Follow-up reminders for recurring issues and scheduled milestones",
                  icon: CheckCircleIcon,
                  label: "Action reminders",
                },
              ].map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-4 rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4"
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-4 w-4 text-accent" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          {item.label}
                        </p>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {item.copy}
                        </p>
                      </div>
                    </div>
                    <Badge tone="default">Unavailable</Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Workspace posture</CardTitle>
              <CardDescription>
                Product credibility comes from explicit boundaries, not hidden
                assumptions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="flex items-start gap-3 rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4">
                <ShieldIcon className="mt-0.5 h-4 w-4 text-accent" />
                Private service keys remain server-side only.
              </div>
              <div className="flex items-start gap-3 rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4">
                <SparkIcon className="mt-0.5 h-4 w-4 text-accent" />
                Chat and analysis stay behind same-origin route handlers.
              </div>
              <div className="flex items-start gap-3 rounded-[1.2rem] border border-border/70 bg-background-subtle/70 px-4 py-4">
                <CheckCircleIcon className="mt-0.5 h-4 w-4 text-accent" />
                Upload URLs are prepared on the server before any image leaves
                the device.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Session controls</CardTitle>
              <CardDescription>
                Use the secure sign-out route when rotating operators or ending
                a shared terminal session.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action="/auth/signout" method="post">
                <Button fullWidth type="submit" variant="surface">
                  Sign out securely
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
