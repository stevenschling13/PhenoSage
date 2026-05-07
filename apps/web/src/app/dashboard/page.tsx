import type { Metadata } from "next";
import Link from "next/link";
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
import { EmptyState } from "@/components/ui/empty-state";
import {
  ArrowRightIcon,
  BellIcon,
  ChatIcon,
  ImageIcon,
  LeafIcon,
  PlusIcon,
  SparklesIcon,
  TrendIcon,
} from "@/components/ui/icons";
import { createSupabaseServerClient, getServerUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const QUICK_ACTIONS = [
  {
    href: "/grows",
    title: "Start a grow",
    description: "Create a grow, link your plants, and pick a stage.",
    Icon: LeafIcon,
  },
  {
    href: "/plants",
    title: "Browse plants",
    description: "See every plant across grows with their latest snapshot.",
    Icon: ImageIcon,
  },
  {
    href: "/assistant",
    title: "Ask the copilot",
    description: "Talk to an AI grounded in your strains and history.",
    Icon: ChatIcon,
  },
];

function formatNumber(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat().format(n);
}

export default async function DashboardPage() {
  const user = await getServerUser();
  if (!user) redirect("/auth?next=/dashboard");

  const supabase = await createSupabaseServerClient();

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [profileRes, growsRes, plantsRes, findingsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("grows")
      .select("id", { count: "exact", head: true })
      .eq("is_archived", false),
    supabase.from("plants").select("id", { count: "exact", head: true }),
    supabase
      .from("plant_findings")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
  ]);

  const displayName = (profileRes.data?.display_name as string | null) ?? null;

  const greetingName =
    displayName?.trim() ||
    (user.email ? user.email.split("@")[0] : null) ||
    "grower";

  const stats: {
    label: string;
    value: string;
    Icon: typeof LeafIcon;
    subtitle: string;
  }[] = [
    {
      label: "Active grows",
      value: formatNumber(growsRes.count ?? null),
      Icon: LeafIcon,
      subtitle: growsRes.error ? "Couldn't load" : "Not archived",
    },
    {
      label: "Plants tracked",
      value: formatNumber(plantsRes.count ?? null),
      Icon: ImageIcon,
      subtitle: plantsRes.error ? "Couldn't load" : "Across all grows",
    },
    {
      label: "Findings (7d)",
      value: formatNumber(findingsRes.count ?? null),
      Icon: TrendIcon,
      subtitle: findingsRes.error ? "Couldn't load" : "Last 7 days",
    },
  ];

  return (
    <AppShell user={{ email: user.email ?? user.id }}>
      <Container width="xl" className="space-y-8 py-8 md:py-10">
        <PageHeader
          eyebrow="Overview"
          title={`Welcome back, ${greetingName}`}
          description="Snapshot of your grow operation. Pick up where you left off."
          actions={
            <>
              <Button
                asChild
                variant="outline"
                size="sm"
                leftIcon={<ChatIcon width={16} height={16} />}
              >
                <Link href="/assistant">Ask copilot</Link>
              </Button>
              <Button
                asChild
                size="sm"
                leftIcon={<PlusIcon width={16} height={16} />}
              >
                <Link href="/grows">New grow</Link>
              </Button>
            </>
          }
        />

        <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-3">
          {stats.map(({ label, value, Icon, subtitle }) => (
            <Card key={label}>
              <CardContent className="flex items-start justify-between p-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                    {value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {subtitle}
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground"
                >
                  <Icon width={20} height={20} />
                </span>
              </CardContent>
            </Card>
          ))}
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Recent activity</CardTitle>
                  <CardDescription>
                    Findings, uploads, and copilot answers across your grows.
                  </CardDescription>
                </div>
                <Badge variant="secondary">Live</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <EmptyState
                icon={<TrendIcon width={20} height={20} />}
                title="No activity yet"
                description="Create a grow and upload a photo to start the timeline."
                action={
                  <Button
                    asChild
                    variant="primary"
                    size="sm"
                    rightIcon={<ArrowRightIcon width={14} height={14} />}
                  >
                    <Link href="/grows">Create your first grow</Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
              <CardDescription>Frequent things you do.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {QUICK_ACTIONS.map(({ href, title, description, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex items-start gap-3 rounded-md border border-transparent p-3 transition-all hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                  >
                    <Icon width={16} height={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {description}
                    </p>
                  </div>
                  <ArrowRightIcon
                    width={16}
                    height={16}
                    className="mt-1 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                  />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-primary/20 bg-accent/40">
          <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/15 text-primary"
            >
              <SparklesIcon width={20} height={20} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">
                Pro tip — enable daily alerts
              </p>
              <p className="text-sm text-muted-foreground">
                Get a morning summary with new findings, suggested tasks, and
                stage-aware reminders.
              </p>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              leftIcon={<BellIcon width={14} height={14} />}
            >
              <Link href="/settings">Configure</Link>
            </Button>
          </CardContent>
        </Card>
      </Container>
    </AppShell>
  );
}
