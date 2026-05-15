import type { Metadata } from "next";
import Link from "next/link";

import { NotificationActions } from "@/components/notifications-list";
import { AlertIcon, BellIcon, SparkIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  listNotifications,
  type NotificationRecord,
} from "@/lib/server/notifications";

export const metadata: Metadata = { title: "Notifications" };

// Always render fresh — the dashboard / bell badge revalidate this
// route on every mark-read action, but a hard reload should always
// reflect the canonical state from the DB.
export const dynamic = "force-dynamic";

function formatRelative(value: string, now = new Date()): string {
  const created = new Date(value);
  const diffMs = now.getTime() - created.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(created);
}

function priorityTone(priority: NotificationRecord["priority"]) {
  if (priority === "critical") return "danger" as const;
  if (priority === "warning") return "warning" as const;
  return "accent" as const;
}

function deepLink(notification: NotificationRecord): string | null {
  const payload = notification.payload ?? {};
  const plantId =
    typeof payload["plantId"] === "string"
      ? (payload["plantId"] as string)
      : null;
  if (plantId) return `/plants/${plantId}`;
  const growId =
    typeof payload["growId"] === "string"
      ? (payload["growId"] as string)
      : null;
  if (growId) return `/grows/${growId}`;
  return null;
}

export default async function NotificationsPage() {
  const notifications = await listNotifications({ limit: 100 });
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <main className="app-page outline-none" id="main-content" tabIndex={-1}>
      <PageHeader
        eyebrow={<Badge tone="accent">Inbox</Badge>}
        title="Notifications"
        description="Daily summaries from the agent and high-severity finding alerts. The agent writes here whenever something material changes in your grows."
        actions={
          unreadCount > 0 ? (
            <NotificationActions kind="mark-all" />
          ) : (
            <Link
              className={buttonStyles({ size: "md", variant: "outline" })}
              href="/dashboard"
            >
              Back to dashboard
            </Link>
          )
        }
      />

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              description="The agent posts here when a daily summary is ready or a high-severity finding lands. Upload your first plant photo to get started."
              icon={<BellIcon className="h-5 w-5" />}
              title="No notifications yet"
            />
          </CardContent>
        </Card>
      ) : (
        <section className="flex flex-col gap-3">
          {notifications.map((notification) => {
            const link = deepLink(notification);
            const isUnread = !notification.readAt;
            return (
              <Card
                key={notification.id}
                className={
                  isUnread ? "border-[rgb(var(--ps-accent)/0.45)]" : undefined
                }
              >
                <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={priorityTone(notification.priority)}>
                        {notification.priority}
                      </Badge>
                      <Badge tone="default">
                        {notification.kind === "finding_alert"
                          ? "alert"
                          : notification.kind === "daily_summary"
                            ? "daily"
                            : notification.kind}
                      </Badge>
                      <span className="ps-mono text-[10.5px] uppercase tracking-[0.12em] text-[rgb(var(--ps-muted))]">
                        {formatRelative(notification.createdAt)}
                      </span>
                      {isUnread ? (
                        <span
                          aria-label="unread"
                          className="inline-block h-2 w-2 rounded-full bg-[rgb(var(--ps-accent))]"
                        />
                      ) : null}
                    </div>
                    <p className="text-[15px] font-medium leading-snug text-[rgb(var(--ps-ink))]">
                      {notification.title}
                    </p>
                    {notification.body ? (
                      <p className="whitespace-pre-line text-[13.5px] leading-[1.55] text-[rgb(var(--ps-ink-2))]">
                        {notification.body}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                    {link ? (
                      <Link
                        className={buttonStyles({
                          size: "sm",
                          variant: "outline",
                        })}
                        href={link}
                      >
                        Open
                      </Link>
                    ) : null}
                    {isUnread ? (
                      <NotificationActions
                        kind="mark-one"
                        notificationId={notification.id}
                      />
                    ) : (
                      <span className="ps-mono text-[10.5px] uppercase tracking-[0.12em] text-[rgb(var(--ps-muted))]">
                        read
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      <Card>
        <CardContent className="flex items-start gap-3 p-5">
          <SparkIcon className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--ps-accent))]" />
          <p className="text-[13px] leading-[1.55] text-[rgb(var(--ps-ink-2))]">
            <span className="font-medium text-[rgb(var(--ps-ink))]">
              How the agent uses this inbox.
            </span>{" "}
            High and critical findings are posted here the moment the analysis
            pipeline detects them — no need to wait for the morning summary. The
            daily digest still runs at 8 AM UTC and rolls up everything that
            happened in the last 24 hours.{" "}
            <AlertIcon
              aria-hidden="true"
              className="ml-1 inline h-3.5 w-3.5 align-text-bottom text-[rgb(var(--ps-muted))]"
            />
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
