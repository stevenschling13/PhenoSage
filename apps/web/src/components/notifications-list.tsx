"use client";

import { useState, useTransition } from "react";

import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(app)/notifications/actions";
import { buttonStyles } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type Props =
  | { kind: "mark-one"; notificationId: string }
  | { kind: "mark-all" };

// Tiny client component that uses React 19's useTransition so the
// caller stays interactive while the server action runs. We keep
// the optimistic story simple: the server action returns a typed
// Result, and on `ok: true` Next.js revalidates `/notifications`
// + `/dashboard` and the row re-renders as "read". On error we
// surface the typed message inline (never the raw provider text).
export function NotificationActions(props: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handle = () => {
    setError(null);
    startTransition(async () => {
      const result =
        props.kind === "mark-one"
          ? await markNotificationReadAction(props.notificationId)
          : await markAllNotificationsReadAction();
      if (!result.ok) {
        setError(result.message);
      }
    });
  };

  const label =
    props.kind === "mark-all"
      ? pending
        ? "Marking…"
        : "Mark all read"
      : pending
        ? "Marking…"
        : "Mark read";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        aria-busy={pending}
        className={cn(
          buttonStyles({
            size: "sm",
            variant: props.kind === "mark-all" ? "primary" : "outline",
          }),
          pending ? "opacity-70" : "",
        )}
      >
        {label}
      </button>
      {error ? (
        <p
          role="alert"
          className="text-[11px] leading-tight text-[rgb(var(--ps-crit))]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
