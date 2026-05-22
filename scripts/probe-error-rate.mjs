#!/usr/bin/env node
// scripts/probe-error-rate.mjs
//
// Phase 2 slice (a) — post-deploy error-rate probe.
//
// Runs from `.github/workflows/post-deploy-smoke.yml` AFTER the existing
// smoke step passes. Queries Vercel Runtime Logs for 5xx count over a
// short window scoped to the just-deployed deploymentId; if the ratio
// against total requests exceeds a configurable threshold AND the absolute
// 5xx count is above a low-traffic floor, exits non-zero. The existing
// rollback step in the workflow catches the non-zero exit and promotes
// the previous production deploy.
//
// Falls back to Sentry's `events` endpoint when Vercel returns no usable
// data (free tier, API gating, etc.). Degrades gracefully — exits 0 with a
// "probe skipped: <reason>" summary — when neither source is available,
// because the contract is "don't make smoke fail on a probe outage."
//
// Env contract:
//
//   VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID, DEPLOYMENT_ID
//     Vercel Runtime Logs source. All four (modulo TEAM_ID, which is
//     optional for personal projects) required to attempt this path.
//   SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG, SENTRY_PROJECT_SLUG, SENTRY_RELEASE
//     Sentry events source. Falls back here when the Vercel path is unusable.
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
//   { source: "vercel"|"sentry"|"none", ok: boolean,
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
 * Probe Vercel Runtime Logs for 5xx count and total request count for the
 * given deployment in the trailing `windowMin` minutes. Returns null when
 * the source isn't usable (auth, plan tier, network) — the caller falls
 * back to Sentry.
 */
export async function probeVercelLogs({
  token,
  projectId,
  teamId,
  deploymentId,
  windowMin,
  fetchImpl,
}) {
  const since = Date.now() - windowMin * 60_000;
  const teamQs = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
  // Vercel's runtime-logs endpoint accepts `since` (ms epoch) and an optional
  // deploymentId filter. Plan tier matters: runtime logs are Pro+. The
  // endpoint returns { logs: [{ statusCode, ... }, ...] } shape.
  const url =
    `https://api.vercel.com/v1/projects/${encodeURIComponent(projectId)}/runtime-logs` +
    `?since=${since}&deploymentId=${encodeURIComponent(deploymentId)}${teamQs}`;
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
  const logs = extractLogsArray(payload);
  if (!logs) return null;
  let errorCount = 0;
  let totalCount = 0;
  for (const log of logs) {
    const status = readStatusCode(log);
    if (status === null) continue;
    totalCount++;
    if (status >= 500 && status <= 599) errorCount++;
  }
  return { errorCount, totalCount };
}

function extractLogsArray(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload.logs;
  return Array.isArray(candidate) ? candidate : null;
}

function readStatusCode(log) {
  if (!log || typeof log !== "object") return null;
  if (typeof log.statusCode === "number") return log.statusCode;
  if (log.proxy && typeof log.proxy.statusCode === "number") {
    return log.proxy.statusCode;
  }
  return null;
}

/**
 * Fallback to Sentry's `events-stats` count when Vercel logs aren't usable.
 * Counts errors in the trailing window scoped to the release tag pushed by
 * `release-on-prod-deploy.yml`. Returns null when Sentry isn't available
 * — the caller logs "probe skipped" and exits 0.
 */
export async function probeSentry({
  authToken,
  org,
  project,
  release,
  windowMin,
  fetchImpl,
}) {
  const statsPeriod = `${windowMin}m`;
  const releaseQs = release
    ? `&query=${encodeURIComponent(`release:${release}`)}`
    : "";
  const url =
    `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/events-stats/` +
    `?project=${encodeURIComponent(project)}&statsPeriod=${statsPeriod}` +
    `&field=count()${releaseQs}`;
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const total = sumSentryStats(payload);
    if (total === null) return null;
    // Sentry's events-stats doesn't distinguish 5xx-vs-2xx; treat every
    // event as an error for the breach calculation. This is a conservative
    // fallback that's louder than Vercel-source — operators should expect
    // false positives if Sentry is the only signal.
    return { errorCount: total, totalCount: total };
  } catch {
    return null;
  }
}

function sumSentryStats(payload) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload.data;
  if (!Array.isArray(data)) return null;
  let sum = 0;
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const value = row[1];
    if (Array.isArray(value) && typeof value[0] === "number") {
      sum += value[0];
    } else if (typeof value === "number") {
      sum += value;
    }
  }
  return sum;
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
  const vercelProject = env.VERCEL_PROJECT_ID && env.VERCEL_PROJECT_ID.trim();
  const vercelTeam = env.VERCEL_TEAM_ID && env.VERCEL_TEAM_ID.trim();
  const deploymentId = env.DEPLOYMENT_ID && env.DEPLOYMENT_ID.trim();

  if (vercelToken && vercelProject && deploymentId) {
    const result = await probeVercelLogs({
      token: vercelToken,
      projectId: vercelProject,
      teamId: vercelTeam || undefined,
      deploymentId,
      windowMin,
      fetchImpl,
    });
    if (result) {
      return finalize({
        source: "vercel",
        windowMin,
        thresholdRatio,
        absoluteFloor,
        ...result,
      });
    }
  }

  const sentryToken = env.SENTRY_AUTH_TOKEN && env.SENTRY_AUTH_TOKEN.trim();
  const sentryOrg = env.SENTRY_ORG_SLUG && env.SENTRY_ORG_SLUG.trim();
  const sentryProject =
    env.SENTRY_PROJECT_SLUG && env.SENTRY_PROJECT_SLUG.trim();
  if (sentryToken && sentryOrg && sentryProject) {
    const result = await probeSentry({
      authToken: sentryToken,
      org: sentryOrg,
      project: sentryProject,
      release: (env.SENTRY_RELEASE && env.SENTRY_RELEASE.trim()) || undefined,
      windowMin,
      fetchImpl,
    });
    if (result) {
      return finalize({
        source: "sentry",
        windowMin,
        thresholdRatio,
        absoluteFloor,
        ...result,
      });
    }
  }

  return {
    source: "none",
    ok: true,
    errorCount: 0,
    totalCount: 0,
    ratio: 0,
    windowMin,
    thresholdRatio,
    absoluteFloor,
    reason:
      "probe skipped: no usable error-rate source (Vercel logs + Sentry both unavailable or unconfigured)",
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
