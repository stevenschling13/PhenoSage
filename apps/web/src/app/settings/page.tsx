import type { Metadata } from "next";
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
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";
import { ProfileForm } from "./profile-form";
import { signOutAction } from "@/app/auth/actions";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/settings");

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const displayName = (profile?.display_name as string | null) ?? "";

  return (
    <AppShell user={{ email: user.email ?? user.id }}>
      <Container width="md" className="space-y-8 py-8 md:py-10">
        <PageHeader
          eyebrow="Account"
          title="Settings"
          description="Profile, notifications, and account controls."
        />

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>How you appear inside PhenoSage.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              email={user.email ?? ""}
              initialDisplayName={displayName}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>Daily summaries and alerts.</CardDescription>
              </div>
              <Badge variant="secondary">Milestone 2</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Notification preferences land with the alerts cron. You&apos;ll be
              able to choose summary cadence, severity threshold, and quiet
              hours.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
            <CardDescription>Sign out of this device.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-end">
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Irreversible actions on your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Account deletion will be wired in once it has a confirmation flow
              with two-factor verification.
            </p>
            <Button variant="destructive" size="sm" disabled>
              Delete account
            </Button>
          </CardContent>
        </Card>
      </Container>
    </AppShell>
  );
}
