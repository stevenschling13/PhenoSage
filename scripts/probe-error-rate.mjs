#!/usr/bin/env node
// scripts/probe-error-rate.mjs
//
// Phase 2 slice (a) — post-deploy error-rate probe.
//
// Runs from `.github/workflows/post-deploy-smoke.yml` AFTER the existing
// smoke step passes. Queries Vercel's `/v3/deployments/{id}/events`
// endpoint for invocation events over a short window scoped to the
// just-deployed Vercel UID; if the 5xx ratio exceeds a configurable
// threshold AND the absolute 5xx count is above a low-traffic floor,
// exits non-zero. The existing rollback step in the workflow catches
// the non-zero exit and promotes the previous production deploy.
//
// Endpoint contract (verified against Vercel REST API docs 2026-05-22):
//
//   GET /v3/deployments/{idOrUrl}/events?since=<ms>&limit=-1
//     - {idOrUrl} accepts either the Vercel deployment UID (dpl_...) or
//       the deployment-specific hostname.
//     - Response: a JSON array of events. The invocation events we care
//       about have shape:
//         { type: "edge-function-invocation"|"middleware-invocation"|
//                 "metric"|...,
//           payload: { statusCode?: number, proxy?: {...}, ... } }
//     - limit=-1 returns all available events for the window (instead of
//       Vercel's default paginated cap).
//
// Sentry fallback was removed in #259 review pass: the previous design
// treated `events-stats` total as both numerator and denominator, which
// always produced ratio=1.0. A correct Sentry signal requires a separate
// transactions/total-requests denominator query. Tracking as a follow-up.
//
// Env contract:
//
//   VERCEL_TOKEN, VERCEL_TEAM_ID (optional), VERCEL_DEPLOYMENT_UID
//     All required to attempt the probe. The workflow step before this
//     one resolves the UID from the GitHub commit SHA via Vercel's
//     /v6/deployments endpoint.
//   WINDOW_MIN            (default 5)    Minutes of recent activity to sample.
//   ERROR_RATE_THRESHOLD  (default 0.01) 5xx / total ratio that trips the probe.
//   ERROR_ABSOLUTE_FLOOR  (default 5)    Min 5xx count before the ratio matters.
//                                        Prevents 1-of-3 (33%) noise from a
//                                        low-traffic window flipping the probe.
//
// CLI contract:
//
//   Exit 0  — probe ran and is within budget, OR was skipped (missing secrets).
//   Exit 1  — probe measured a real breach; workflow should roll back.
//
// Every run writes a single JSON log line to stdout that the workflow can
// parse for the Discord/issue body. Shape:
//
//   { source: "vercel"|"none", ok: boolean,
//     errorCount, totalCount, ratio, windowMin, reason }

const DEFAULT_WINDOW_MIN = 5;
const DEFAULT_ERROR_RATE_THRESHOLD = 0.01;
const DEFAULT_ERROR_ABSOLUTE_FLOOR = 5;

/**
 * Decide whether an error-count snapshot constitutes a breach.
 *
 * A breach requires BOTH:
 *   1. Absolute 5xx count >= `absoluteFloor` — otherwise low-traffic noise
 *      (1 error / 3 requests = 33%) flips the probe on a quiet deploy.
 *   2. Ratio of errors to total requests >= `thresholdRatio`.
 *
 * Pure function so it's trivially testable.
 */
export function isBreach({
  errorCount,
  totalCount,
  thresholdRatio,
  absoluteFloor,
}) {
  if (totalCount <= 0) return false;
  if (errorCount < absoluteFloor) return false;
  const ratio = errorCount / totalCount;
  return ratio >= thresholdRatio;
}

/**
 * Probe Vercel deployment events for 5xx count and total invocation count
 * for the given deployment in the trailing `windowMin` minutes. Returns
 * null when the source isn't usable (auth, plan tier, network, missing
 * fields) — the caller logs "probe skipped" and exits 0.
 */
export async function probeVercelEvents({
  token,
  teamId,
  deploymentId,
  windowMin,
  fetchImpl,
}) {
  const since = Date.now() - windowMin * 60_000;
  const params = new URLSearchParams({
    since: String(since),
    // -1 returns all events available in the window (default would
    // paginate at ~100; gemini-code-assist caught this).
    limit: "-1",
  });
  if (teamId) params.set("teamId", teamId);
  const url = `https://api.vercel.com/v3/deployments/${encodeURIComponent(
    deploymentId,
  )}/events?${params.toString()}`;
  let payload;
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    payload = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(payload)) return null;
  let errorCount = 0;
  let totalCount = 0;
  for (const event of payload) {
    const status = readStatusCode(event);
    if (status === null) continue;
    totalCount++;
    if (status >= 500 && status <= 599) errorCount++;
  }
  return { errorCount, totalCount };
}

function readStatusCode(event) {
  if (!event || typeof event !== "object") return null;
  // Invocation events carry the HTTP status on `payload.statusCode` per
  // the v3 endpoint schema. Fall back to legacy shapes to stay friendly
  // to API drift / older event variants.
  if (event.payload && typeof event.payload.statusCode === "number") {
    return event.payload.statusCode;
  }
  if (typeof event.statusCode === "number") return event.statusCode;
  return null;
}

export async function evaluate({ env, fetchImpl = fetch }) {
  const windowMin = readInt(env.WINDOW_MIN, DEFAULT_WINDOW_MIN);
  const thresholdRatio = readFloat(
    env.ERROR_RATE_THRESHOLD,
    DEFAULT_ERROR_RATE_THRESHOLD,
  );
  const absoluteFloor = readInt(
    env.ERROR_ABSOLUTE_FLOOR,
    DEFAULT_ERROR_ABSOLUTE_FLOOR,
  );

  const vercelToken = env.VERCEL_TOKEN && env.VERCEL_TOKEN.trim();
  const vercelTeam = env.VERCEL_TEAM_ID && env.VERCEL_TEAM_ID.trim();
  const deploymentId =
    env.VERCEL_DEPLOYMENT_UID && env.VERCEL_DEPLOYMENT_UID.trim();

  if (!vercelToken || !deploymentId) {
    return skipResult({
      windowMin,
      thresholdRatio,
      absoluteFloor,
      reason: !vercelToken
        ? "probe skipped: VERCEL_TOKEN not configured"
        : "probe skipped: VERCEL_DEPLOYMENT_UID not resolved (no Vercel deployment found for this commit SHA)",
    });
  }

  const result = await probeVercelEvents({
    token: vercelToken,
    teamId: vercelTeam || undefined,
    deploymentId,
    windowMin,
    fetchImpl,
  });
  if (!result) {
    return skipResult({
      windowMin,
      thresholdRatio,
      absoluteFloor,
      reason:
        "probe skipped: Vercel events API returned no usable data (auth/plan/network)",
    });
  }
  return finalize({
    source: "vercel",
    windowMin,
    thresholdRatio,
    absoluteFloor,
    ...result,
  });
}

function skipResult({ windowMin, thresholdRatio, absoluteFloor, reason }) {
  return {
    source: "none",
    ok: true,
    errorCount: 0,
    totalCount: 0,
    ratio: 0,
    windowMin,
    thresholdRatio,
    absoluteFloor,
    reason,
  };
}

function finalize({
  source,
  windowMin,
  thresholdRatio,
  absoluteFloor,
  errorCount,
  totalCount,
}) {
  const ratio = totalCount > 0 ? errorCount / totalCount : 0;
  const breach = isBreach({
    errorCount,
    totalCount,
    thresholdRatio,
    absoluteFloor,
  });
  return {
    source,
    ok: !breach,
    errorCount,
    totalCount,
    ratio,
    windowMin,
    thresholdRatio,
    absoluteFloor,
    reason: breach
      ? `breach: ${errorCount} 5xx of ${totalCount} requests (${(ratio * 100).toFixed(2)}%) over ${windowMin}m via ${source}, threshold ${(thresholdRatio * 100).toFixed(2)}%`
      : `within budget: ${errorCount} 5xx of ${totalCount} requests (${(ratio * 100).toFixed(2)}%) over ${windowMin}m via ${source}`,
  };
}

function readInt(value, fallback) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readFloat(value, fallback) {
  if (!value) return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// CLI entry: read env, call evaluate(), write JSON to stdout, exit
// non-zero only on a measured breach.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await evaluate({ env: process.env });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 1);
}
