import "server-only";

import type { FindingSeverity } from "@phenosage/shared";

import type { DailyDigestSnapshot } from "./daily-digest";

// ────────────────────────────────────────────────────────────────────────────
// HTML escaping
// ────────────────────────────────────────────────────────────────────────────

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Minimal HTML escape for user-derived strings inserted into the
 * email template. Mirrors the convention enforced by
 * scripts/check-code-scanning-patterns.mjs (no React inline-HTML escape hatch)
 * — every user-derived string in HTML output passes through this.
 */
function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  tags: { name: string; value: string }[];
}

// ────────────────────────────────────────────────────────────────────────────
// Daily summary
// ────────────────────────────────────────────────────────────────────────────

export interface DailySummaryEmailParams {
  snapshot: DailyDigestSnapshot;
  /** AI-rendered title from `renderDigest` (the in-app notification's `title`). */
  title: string;
  /** AI-rendered body from `renderDigest` (2-3 sentences). */
  body: string;
  /** User's local calendar date (`YYYY-MM-DD`) used as the dedupe key. */
  occurredOn: string;
  /** `NEXT_PUBLIC_APP_URL`, or the fallback for local dev. */
  appUrl: string;
}

/**
 * Build the daily summary email. Idempotency key is
 * `daily-summary:<userId>:<occurredOn>` — Resend's 24h dedupe window
 * matches the cron's once-per-day cadence so a same-day re-run is a
 * no-op at the provider, and the same-day `notifications.email_sent_at`
 * column short-circuits before we ever call this.
 */
export function dailySummaryEmail(p: DailySummaryEmailParams): BuiltEmail {
  const dashboardUrl = `${trimSlash(p.appUrl)}/dashboard`;
  const safeTitle = escapeHtml(p.title);
  const safeBody = escapeHtml(p.body);
  const findingItems = p.snapshot.newFindings.slice(0, 5).map((f) => ({
    severity: f.severity as FindingSeverity,
    title: f.title,
  }));

  const findingsHtml =
    findingItems.length === 0
      ? ""
      : `<ul style="padding-left:1.25rem;margin:0 0 1rem">${findingItems
          .map(
            (f) =>
              `<li><strong>[${escapeHtml(f.severity)}]</strong> ${escapeHtml(
                f.title,
              )}</li>`,
          )
          .join("")}</ul>`;

  const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin:0 0 12px">${safeTitle}</h1>
  <p style="margin:0 0 16px;line-height:1.5">${safeBody}</p>
  ${findingsHtml}
  <p style="margin:24px 0 0">
    <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:10px 16px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px">Open dashboard</a>
  </p>
  <p style="margin:24px 0 0;font-size:12px;color:#64748b">
    You're receiving this because daily summary emails are enabled in
    your PhenoSage settings. <a href="${escapeHtml(`${trimSlash(p.appUrl)}/settings`)}" style="color:#64748b">Manage notifications</a>.
  </p>
</body></html>`;

  const findingsText =
    findingItems.length === 0
      ? ""
      : findingItems.map((f) => `  - [${f.severity}] ${f.title}`).join("\n") +
        "\n\n";

  const text = `${p.title}

${p.body}

${findingsText}Open dashboard: ${dashboardUrl}

Manage notifications: ${trimSlash(p.appUrl)}/settings`;

  return {
    subject: p.title,
    html,
    text,
    idempotencyKey: `daily-summary:${p.snapshot.userId}:${p.occurredOn}`,
    tags: [
      { name: "kind", value: "daily_summary" },
      { name: "occurred_on", value: p.occurredOn },
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Finding alert
// ────────────────────────────────────────────────────────────────────────────

export interface FindingAlertEmailParams {
  userId: string;
  findingId: string;
  plantId: string;
  growId: string;
  severity: FindingSeverity;
  title: string;
  body: string | null;
  appUrl: string;
}

export function findingAlertEmail(p: FindingAlertEmailParams): BuiltEmail {
  const findingUrl = `${trimSlash(p.appUrl)}/plants/${encodeURIComponent(p.plantId)}#finding-${encodeURIComponent(p.findingId)}`;
  const heading =
    p.severity === "critical"
      ? `Critical: ${p.title}`
      : `${capitalize(p.severity)}: ${p.title}`;
  const safeHeading = escapeHtml(heading);
  const safeBody = escapeHtml(p.body ?? "");

  const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin:0 0 12px;color:${p.severity === "critical" ? "#b91c1c" : "#b45309"}">${safeHeading}</h1>
  ${safeBody ? `<p style="margin:0 0 16px;line-height:1.5;white-space:pre-wrap">${safeBody}</p>` : ""}
  <p style="margin:24px 0 0">
    <a href="${escapeHtml(findingUrl)}" style="display:inline-block;padding:10px 16px;background:#0f172a;color:#fff;text-decoration:none;border-radius:6px">Review the finding</a>
  </p>
  <p style="margin:24px 0 0;font-size:12px;color:#64748b">
    You're receiving this because finding alert emails are enabled in
    your PhenoSage settings. <a href="${escapeHtml(`${trimSlash(p.appUrl)}/settings`)}" style="color:#64748b">Manage notifications</a>.
  </p>
</body></html>`;

  const text = `${heading}

${p.body ?? ""}

Review the finding: ${findingUrl}

Manage notifications: ${trimSlash(p.appUrl)}/settings`;

  return {
    subject: heading,
    html,
    text,
    idempotencyKey: `finding-alert:${p.findingId}`,
    tags: [
      { name: "kind", value: "finding_alert" },
      { name: "severity", value: p.severity },
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────────

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
