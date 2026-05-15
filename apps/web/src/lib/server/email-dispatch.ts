import "server-only";

import type { FindingSeverity } from "@phenosage/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DailyDigestSnapshot } from "./daily-digest";
import {
  dailySummaryEmail,
  findingAlertEmail,
  type BuiltEmail,
} from "./email-templates";
import {
  sendTransactionalEmail,
  type SendTransactionalEmailResult,
} from "./email";
import { logServerEvent } from "./request-id";
import type { UserPreferences } from "./user-preferences";

// Severity ordinals so a user's `email_alert_severity_floor` can be
// compared against a finding's severity. Higher number = more severe.
const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export type DispatchSkipReason =
  | "opt_out"
  | "below_floor"
  | "no_email"
  | "disabled"
  | "failed";

export type DispatchOutcome =
  | { sent: true; providerId: string }
  | { sent: false; reason: DispatchSkipReason };

/**
 * Resolve the user's email-of-record from `auth.users`. Uses the
 * service-role admin API (the supabase client passed in MUST be the
 * service-role one). Returns null on any failure or when the user
 * has no email — both cases are logged at info, not error, because
 * a missing email is a normal state (some auth methods don't require
 * one in the future).
 */
async function loadUserEmail(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) {
      logServerEvent("warn", "email-dispatch: getUserById failed", {
        userId,
        error: error.message,
      });
      return null;
    }
    const email = data?.user?.email;
    return typeof email === "string" && email.length > 0 ? email : null;
  } catch (err) {
    logServerEvent("warn", "email-dispatch: getUserById threw", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Stamp `notifications.email_sent_at` so a same-day re-run of the cron
 * (or a re-emit of a finding alert) doesn't double-send. The column is
 * service-role-write only (see migration 014's column-restriction
 * trigger, refreshed in migration 018 to also lock down email_sent_at
 * from user updates). Failure to stamp is logged but never propagated
 * — the email already went out, the worst case is one duplicate at the
 * provider's idempotency window edge (which Resend will dedupe anyway).
 */
async function stampEmailSent(
  supabase: SupabaseClient,
  notificationId: string,
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ email_sent_at: new Date().toISOString() })
    .eq("id", notificationId);
  if (error) {
    logServerEvent("warn", "email-dispatch: stamp email_sent_at failed", {
      notificationId,
      error: error.message,
      code: error.code,
    });
  }
}

function summariseSendResult(
  result: SendTransactionalEmailResult,
): DispatchOutcome {
  if (result.ok) return { sent: true, providerId: result.id };
  if (result.code === "disabled") return { sent: false, reason: "disabled" };
  return { sent: false, reason: "failed" };
}

// ────────────────────────────────────────────────────────────────────────────
// Daily summary
// ────────────────────────────────────────────────────────────────────────────

export interface DispatchDailySummaryParams {
  supabase: SupabaseClient;
  userId: string;
  notificationId: string;
  preferences: UserPreferences;
  snapshot: DailyDigestSnapshot;
  rendered: { title: string; body: string };
  occurredOn: string;
  appUrl: string;
}

export async function dispatchDailySummaryEmail(
  p: DispatchDailySummaryParams,
): Promise<DispatchOutcome> {
  if (!p.preferences.emailDailySummary) {
    return { sent: false, reason: "opt_out" };
  }
  const email = await loadUserEmail(p.supabase, p.userId);
  if (!email) return { sent: false, reason: "no_email" };

  const built: BuiltEmail = dailySummaryEmail({
    snapshot: p.snapshot,
    title: p.rendered.title,
    body: p.rendered.body,
    occurredOn: p.occurredOn,
    appUrl: p.appUrl,
  });

  const result = await sendTransactionalEmail({
    to: email,
    subject: built.subject,
    html: built.html,
    text: built.text,
    idempotencyKey: built.idempotencyKey,
    tags: built.tags,
  });

  if (result.ok) {
    await stampEmailSent(p.supabase, p.notificationId);
  }
  return summariseSendResult(result);
}

// ────────────────────────────────────────────────────────────────────────────
// Finding alert
// ────────────────────────────────────────────────────────────────────────────

export interface DispatchFindingAlertParams {
  supabase: SupabaseClient;
  userId: string;
  notificationId: string;
  preferences: UserPreferences;
  finding: {
    findingId: string;
    plantId: string;
    growId: string;
    severity: FindingSeverity;
    title: string;
    body: string | null;
  };
  appUrl: string;
}

export async function dispatchFindingAlertEmail(
  p: DispatchFindingAlertParams,
): Promise<DispatchOutcome> {
  if (!p.preferences.emailFindingAlerts) {
    return { sent: false, reason: "opt_out" };
  }
  if (
    SEVERITY_ORDER[p.finding.severity] <
    SEVERITY_ORDER[p.preferences.emailAlertSeverityFloor]
  ) {
    return { sent: false, reason: "below_floor" };
  }
  const email = await loadUserEmail(p.supabase, p.userId);
  if (!email) return { sent: false, reason: "no_email" };

  const built: BuiltEmail = findingAlertEmail({
    userId: p.userId,
    findingId: p.finding.findingId,
    plantId: p.finding.plantId,
    growId: p.finding.growId,
    severity: p.finding.severity,
    title: p.finding.title,
    body: p.finding.body,
    appUrl: p.appUrl,
  });

  const result = await sendTransactionalEmail({
    to: email,
    subject: built.subject,
    html: built.html,
    text: built.text,
    idempotencyKey: built.idempotencyKey,
    tags: built.tags,
  });

  if (result.ok) {
    await stampEmailSent(p.supabase, p.notificationId);
  }
  return summariseSendResult(result);
}
