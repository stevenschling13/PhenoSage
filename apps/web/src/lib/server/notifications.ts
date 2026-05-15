import "server-only";

import type { FindingSeverity } from "@phenosage/shared";

import { createSupabaseServerClient, getServerUser } from "./auth";
import { getDbClient } from "./db";
import { dispatchFindingAlertEmail } from "./email-dispatch";
import { logServerEvent } from "./request-id";
import { loadUserPreferences, type UserPreferences } from "./user-preferences";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type NotificationKind =
  | "daily_summary"
  | "finding_alert"
  | "collaborator_invite"
  | "system";

export type NotificationPriority = "info" | "warning" | "critical";

export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  occurredOn: string | null;
  readAt: string | null;
  createdAt: string;
}

// Result discriminated-union pattern (Next.js 15+/React 19 best practice):
// server actions never throw for business-logic failures, they return
// a typed Result the client can pattern-match on.
export type NotificationActionResult =
  | { ok: true }
  | { ok: false; code: NotificationActionErrorCode; message: string };

export type NotificationActionErrorCode =
  | "unauthenticated"
  | "not_found"
  | "permission_denied"
  | "service_unavailable"
  | "unknown";

// ────────────────────────────────────────────────────────────────────────────
// Listing / counting (RLS-scoped via user client)
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
// Cap previews so even an essay-sized AI digest doesn't bloat the
// dashboard payload.
const PREVIEW_BODY_MAX = 240;

interface NotificationRowFromDb {
  id: string;
  kind: NotificationKind;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  occurred_on: string | null;
  read_at: string | null;
  created_at: string;
}

function rowToRecord(row: NotificationRowFromDb): NotificationRecord {
  return {
    id: row.id,
    kind: row.kind,
    priority: row.priority,
    title: row.title,
    body: row.body,
    payload: row.payload,
    occurredOn: row.occurred_on,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/**
 * List notifications for the current user, newest first. RLS-scoped:
 * the user-context Supabase client already filters to `auth.uid() =
 * user_id` via migration 014's "notifications: self read" policy, so
 * no explicit filter is needed (and adding one would be a footgun if
 * the policy ever changes). On any error we degrade to an empty list
 * and log — the dashboard renders an empty state rather than a 500.
 */
export async function listNotifications(
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationRecord[]> {
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_LIST_LIMIT, 1),
    MAX_LIST_LIMIT,
  );

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    logServerEvent("error", "notifications: client init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  let query = supabase
    .from("notifications")
    .select(
      "id,kind,priority,title,body,payload,occurred_on,read_at,created_at",
    )
    .order("created_at", { ascending: false });

  if (options.unreadOnly) {
    query = query.is("read_at", null);
  }

  const { data, error } = await query.limit(limit);
  if (error) {
    logServerEvent("error", "notifications: list failed", {
      error: error.message,
      code: error.code,
    });
    return [];
  }

  const rows = (data ?? []) as NotificationRowFromDb[];
  return rows.map(rowToRecord);
}

/**
 * Returns the count of unread notifications for the current user, or
 * 0 on error. The dashboard badge calls this on every render, so it
 * has to be cheap and degrade gracefully — never throw.
 */
export async function countUnreadNotifications(): Promise<number> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    logServerEvent("error", "notifications: count client init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  if (error) {
    logServerEvent("error", "notifications: count failed", {
      error: error.message,
      code: error.code,
    });
    return 0;
  }
  return count ?? 0;
}

/**
 * Trim a notification body to a fixed preview length without breaking
 * mid-word — used by the dashboard preview card.
 */
export function previewBody(body: string | null): string | null {
  if (!body) return null;
  if (body.length <= PREVIEW_BODY_MAX) return body;
  const cut = body.slice(0, PREVIEW_BODY_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut) + "…";
}

// ────────────────────────────────────────────────────────────────────────────
// Mutations (server-action callable; typed Result, never throws for
// business-logic failures — only re-throws Next framework signals)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mark a single notification as read. Uses the user-context client so
 * RLS + the column-restriction trigger from migration 014 enforces:
 * users may only flip `read_at` on their own rows.
 *
 * Friendly error mapping mirrors createGrowAction (SQLSTATE 42501 →
 * permission_denied, 08xxx / connection errors → service_unavailable)
 * so the UI can render copy without echoing raw provider text.
 */
export async function markNotificationRead(
  notificationId: string,
): Promise<NotificationActionResult> {
  if (
    typeof notificationId !== "string" ||
    notificationId.length === 0 ||
    notificationId.length > 64
  ) {
    return {
      ok: false,
      code: "not_found",
      message: "Notification not found.",
    };
  }

  const user = await getServerUser().catch(() => null);
  if (!user) {
    return {
      ok: false,
      code: "unauthenticated",
      message: "Sign in again to mark notifications as read.",
    };
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    logServerEvent("error", "notifications: mark-read client init failed", {
      error: err instanceof Error ? err.message : String(err),
      userId: user.id,
    });
    return {
      ok: false,
      code: "service_unavailable",
      message: "Notifications are temporarily unavailable. Try again shortly.",
    };
  }

  const { error, data } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .is("read_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return mapPostgrestError(error, user.id, "mark notification read");
  }
  // `data` is null when the row didn't exist OR was already read OR
  // RLS hid it. All three are user-visible "no-op" cases — return ok
  // so the UI stops the spinner without pretending we did something.
  if (!data) {
    return { ok: true };
  }
  return { ok: true };
}

/**
 * Mark every unread notification as read for the current user.
 * Idempotent: the `read_at IS NULL` filter means a re-run is a no-op.
 */
export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const user = await getServerUser().catch(() => null);
  if (!user) {
    return {
      ok: false,
      code: "unauthenticated",
      message: "Sign in again to mark notifications as read.",
    };
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    logServerEvent("error", "notifications: mark-all client init failed", {
      error: err instanceof Error ? err.message : String(err),
      userId: user.id,
    });
    return {
      ok: false,
      code: "service_unavailable",
      message: "Notifications are temporarily unavailable. Try again shortly.",
    };
  }

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  if (error) {
    return mapPostgrestError(error, user.id, "mark all notifications read");
  }
  return { ok: true };
}

interface PostgrestErrorLike {
  message: string;
  code?: string | null;
}

function mapPostgrestError(
  error: PostgrestErrorLike,
  userId: string,
  context: string,
): NotificationActionResult {
  logServerEvent("error", `notifications: ${context} failed`, {
    error: error.message,
    code: error.code ?? undefined,
    userId,
  });
  const code = error.code ?? "";
  if (code === "42501") {
    return {
      ok: false,
      code: "permission_denied",
      message: "You don't have permission to update this notification.",
    };
  }
  if (code.startsWith("08") || code === "57014") {
    return {
      ok: false,
      code: "service_unavailable",
      message: "Notifications are temporarily unavailable. Try again shortly.",
    };
  }
  return {
    ok: false,
    code: "unknown",
    message: "We couldn't update notifications right now. Please retry.",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Event-driven agent trigger: emit `finding_alert` rows immediately
// when a high/critical severity finding lands, instead of waiting for
// the daily-summary cron.
// ────────────────────────────────────────────────────────────────────────────

export interface FindingAlertInput {
  findingId: string;
  plantId: string;
  growId: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  recommendation?: string | null;
  category?: string;
}

const ALERTABLE_SEVERITIES: ReadonlySet<FindingSeverity> = new Set([
  "high",
  "critical",
]);

const ALERT_BODY_MAX = 600;

function severityToPriority(severity: FindingSeverity): NotificationPriority {
  if (severity === "critical") return "critical";
  if (severity === "high") return "warning";
  return "info";
}

function buildAlertBody(input: FindingAlertInput): string {
  const parts: string[] = [];
  if (input.description) parts.push(input.description);
  if (input.recommendation)
    parts.push(`Suggested next step: ${input.recommendation}`);
  const body = parts.join("\n\n");
  if (body.length <= ALERT_BODY_MAX) return body;
  return body.slice(0, ALERT_BODY_MAX - 1) + "…";
}

/**
 * Emit a `finding_alert` notification row for each high/critical
 * severity finding. Skips low-severity findings silently. Uses the
 * service-role client because the analysis pipeline runs in a Route
 * Handler under the user's session but writes to a table where users
 * have no INSERT policy (writes are service-role-only by design;
 * see migration 014 access model).
 *
 * Idempotency: migration 016 adds a partial UNIQUE on
 * `(user_id, (payload->>'findingId'))` with predicate
 * `WHERE kind = 'finding_alert' AND (payload->>'findingId') IS NOT NULL`
 * — `kind` lives in the partial index *predicate*, not in the index
 * key. Because PostgREST's `on_conflict` parameter only accepts plain
 * column names and cannot resolve to an expression-index target, this
 * function performs an app-level SELECT-then-INSERT: we look up which
 * candidate findingIds already have an alert and INSERT only the rest.
 * The partial UNIQUE remains as a race backstop — a concurrent emit
 * that slips through raises SQLSTATE 23505, which we log at `info`
 * and treat as a benign no-op (the user already has the alert).
 *
 * This matters because `runAndPersistPlantAnalysis` is called both on
 * photo upload AND from the chat tool `trigger_plant_analysis`, and
 * the same finding can be regenerated.
 *
 * Failure isolation: a row-level insert failure is logged but does
 * NOT propagate — the analysis itself has already succeeded and the
 * user must still see their findings. The alert is a best-effort
 * proactive surface, not a system-of-record write.
 *
 * Returns the number of rows actually inserted (for tests / metrics).
 */
export async function emitFindingAlerts(params: {
  userId: string;
  findings: FindingAlertInput[];
  requestId: string;
}): Promise<number> {
  const alertable = params.findings.filter((f) =>
    ALERTABLE_SEVERITIES.has(f.severity),
  );
  if (alertable.length === 0) return 0;

  let db;
  try {
    db = getDbClient();
  } catch (err) {
    logServerEvent("error", "finding alerts: db client init failed", {
      requestId: params.requestId,
      userId: params.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }

  const rows = alertable.map((finding) => ({
    user_id: params.userId,
    kind: "finding_alert" as const,
    priority: severityToPriority(finding.severity),
    title: `${finding.severity === "critical" ? "Critical" : "High"}: ${finding.title}`,
    body: buildAlertBody(finding),
    payload: {
      findingId: finding.findingId,
      plantId: finding.plantId,
      growId: finding.growId,
      severity: finding.severity,
      ...(finding.category ? { category: finding.category } : {}),
    },
    // occurred_on intentionally NULL — finding alerts are event-keyed,
    // not day-keyed. Dedupe runs through migration 016's partial
    // UNIQUE on payload->>'findingId'.
    occurred_on: null as string | null,
  }));

  // PostgREST's `on_conflict` parameter expects column names matching a
  // constraint and doesn't reliably resolve to an expression index like
  // `(user_id, (payload->>'findingId'))`. So we do an app-level SELECT
  // first to filter out already-emitted alerts, then INSERT the rest.
  // The partial UNIQUE from migration 016 is a backstop against races
  // — if a concurrent emit slips through, the resulting 23505 is
  // logged but treated as a benign no-op (the user already has the
  // alert).
  const candidateIds = rows
    .map((r) => (r.payload as { findingId: string }).findingId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  let existingIds = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: existing, error: existingErr } = await db
      .from("notifications")
      .select("payload")
      .eq("user_id", params.userId)
      .eq("kind", "finding_alert")
      .in("payload->>findingId", candidateIds);
    if (existingErr) {
      // Soft-fail: log and proceed with full insert. The partial
      // unique index will catch any true duplicates as 23505.
      logServerEvent("warn", "finding alerts: dedupe lookup failed", {
        requestId: params.requestId,
        userId: params.userId,
        error: existingErr.message,
        code: existingErr.code,
      });
    } else {
      for (const row of existing ?? []) {
        const fid = (row as { payload?: { findingId?: string } }).payload
          ?.findingId;
        if (typeof fid === "string") existingIds.add(fid);
      }
    }
  }

  const toInsert = rows.filter(
    (r) => !existingIds.has((r.payload as { findingId: string }).findingId),
  );
  if (toInsert.length === 0) {
    logServerEvent("info", "finding alerts: all already emitted", {
      requestId: params.requestId,
      userId: params.userId,
      attempted: rows.length,
    });
    return 0;
  }

  const { data, error } = await db
    .from("notifications")
    .insert(toInsert)
    .select("id");

  if (error) {
    // 23505 from the partial unique index = a concurrent emit beat us.
    // Treat as a benign no-op so the analysis pipeline never fails
    // because of a notification dedupe race.
    if (error.code === "23505") {
      logServerEvent("info", "finding alerts: dedupe race ignored", {
        requestId: params.requestId,
        userId: params.userId,
        attempted: toInsert.length,
      });
      return 0;
    }
    logServerEvent("error", "finding alerts: insert failed", {
      requestId: params.requestId,
      userId: params.userId,
      error: error.message,
      code: error.code,
      attempted: toInsert.length,
    });
    return 0;
  }

  const inserted = (data ?? []).length;
  logServerEvent("info", "finding alerts emitted", {
    requestId: params.requestId,
    userId: params.userId,
    attempted: rows.length,
    inserted,
  });

  // Best-effort transactional email per newly-inserted alert. We
  // load the user's preferences once (cheap — single row), then
  // dispatch in parallel. Email failures are logged inside the
  // dispatcher and do NOT propagate; the in-app notification is the
  // system-of-record. We only email for newly-inserted rows so the
  // dedupe path (existing alert) doesn't re-spam the user.
  if (inserted > 0) {
    // Supabase preserves row order on `insert(...).select(...)`, so
    // map back to the original alertable input by index — that's how
    // we recover the title/description/recommendation context the
    // email template needs.
    const newRows = toInsert
      .map((r, idx) => ({ ...r, id: (data?.[idx] as { id?: string })?.id }))
      .filter((r): r is typeof r & { id: string } => typeof r.id === "string");

    let preferences: UserPreferences | null = null;
    try {
      preferences = await loadUserPreferences(db, params.userId);
    } catch (err) {
      logServerEvent("warn", "finding alerts: load preferences failed", {
        requestId: params.requestId,
        userId: params.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (preferences && preferences.emailFindingAlerts) {
      const appUrl =
        process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3000";
      const findingsById = new Map(alertable.map((f) => [f.findingId, f]));
      const userPrefs = preferences;
      await Promise.all(
        newRows.map(async (row) => {
          const payload = row.payload as { findingId?: string };
          const fid = payload.findingId;
          if (!fid) return;
          const original = findingsById.get(fid);
          if (!original) return;
          await dispatchFindingAlertEmail({
            supabase: db,
            userId: params.userId,
            notificationId: row.id,
            preferences: userPrefs,
            finding: {
              findingId: original.findingId,
              plantId: original.plantId,
              growId: original.growId,
              severity: original.severity,
              title: original.title,
              body: row.body,
            },
            appUrl,
          }).catch((err) => {
            logServerEvent("warn", "finding alerts: email dispatch threw", {
              requestId: params.requestId,
              userId: params.userId,
              findingId: original.findingId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }),
      );
    }
  }

  return inserted;
}
