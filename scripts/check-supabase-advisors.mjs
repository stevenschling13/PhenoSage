#!/usr/bin/env node
// scripts/check-supabase-advisors.mjs
//
// Calls Supabase's Management API advisors endpoints
// (https://api.supabase.com/v1/projects/{ref}/advisors/{security|performance})
// and fails the CI run when ERROR-level findings are present.
//
// Surfaces drift that nothing else catches:
//
//   * RLS missing on a new public-schema table.
//   * Functions with mutable `search_path` (a Supabase-flagged SQL
//     injection vector on SECURITY DEFINER routines — relevant to the
//     RPCs we added in migrations 005 and 20260521190000).
//   * Auth password protection toggles drifting OFF.
//   * Index advice on hot foreign keys.
//
// Prerequisites:
//   * SUPABASE_ACCESS_TOKEN  — personal / CI token from Supabase Dashboard
//   * SUPABASE_PROJECT_REF   — production project ref
//
// Exit codes:
//   0 — no ERROR-level lints (WARN/INFO are logged but don't fail).
//   1 — at least one ERROR-level lint, OR prerequisites missing, OR
//       Management API call failed.
//
// Intentionally NOT in `pnpm run validate` — requires network + cloud
// credentials and runs from `.github/workflows/supabase-advisors.yml`
// on a nightly schedule + workflow_dispatch.

const SUPABASE_API_BASE = "https://api.supabase.com/v1";

/**
 * Buckets a list of advisor lints by severity and returns a decision.
 *
 * Severity contract (per Supabase advisor schema):
 *   ERROR — must fix; CI gate fails on any of these.
 *   WARN  — should investigate; CI logs them but stays green.
 *   INFO  — informational; CI logs them.
 *
 * Pure function so it's trivially testable.
 */
export function classifyLints(lints) {
  const errors = [];
  const warns = [];
  const infos = [];
  for (const lint of Array.isArray(lints) ? lints : []) {
    if (!lint || typeof lint !== "object") continue;
    const level =
      typeof lint.level === "string" ? lint.level.toUpperCase() : "";
    if (level === "ERROR") errors.push(lint);
    else if (level === "WARN" || level === "WARNING") warns.push(lint);
    else infos.push(lint);
  }
  return { errors, warns, infos };
}

/**
 * Pretty-print a single lint for the run summary. Includes the
 * remediation URL when present so the operator can jump straight to
 * the docs page.
 */
export function formatLint(lint, kind) {
  const level = (lint.level || "?").toUpperCase();
  const title = lint.title || lint.name || "(untitled)";
  const cat =
    Array.isArray(lint.categories) && lint.categories.length
      ? ` [${lint.categories.join(", ")}]`
      : "";
  const facing = lint.facing ? ` facing=${lint.facing}` : "";
  const remediation =
    typeof lint.remediation === "string" && lint.remediation
      ? `\n      Remediation: ${lint.remediation}`
      : "";
  const detail = lint.detail ? `\n      ${lint.detail}` : "";
  return `  [${kind}][${level}]${cat}${facing} ${title}${detail}${remediation}`;
}

async function fetchAdvisors({ accessToken, projectRef, kind, fetchImpl }) {
  const url = `${SUPABASE_API_BASE}/projects/${encodeURIComponent(projectRef)}/advisors/${encodeURIComponent(kind)}`;
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable>");
    throw new Error(
      `Supabase advisors ${kind} HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const payload = await res.json();
  return Array.isArray(payload?.lints) ? payload.lints : [];
}

export async function runAdvisorsCheck({
  env,
  fetchImpl = fetch,
  log = console.log,
  warn = console.warn,
  error = console.error,
}) {
  const accessToken = env.SUPABASE_ACCESS_TOKEN?.trim();
  const projectRef = env.SUPABASE_PROJECT_REF?.trim();
  if (!accessToken || !projectRef) {
    error(
      "✗ check-supabase-advisors: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF must both be set",
    );
    return { ok: false, reason: "missing-prereqs" };
  }

  let security;
  let performance;
  try {
    [security, performance] = await Promise.all([
      fetchAdvisors({
        accessToken,
        projectRef,
        kind: "security",
        fetchImpl,
      }),
      fetchAdvisors({
        accessToken,
        projectRef,
        kind: "performance",
        fetchImpl,
      }),
    ]);
  } catch (err) {
    error(
      `✗ check-supabase-advisors: API call failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, reason: "api-error" };
  }

  const sec = classifyLints(security);
  const perf = classifyLints(performance);

  // WARN + INFO are surfaced but never gate. Operators can scan the
  // workflow run summary to spot trends without the rest of the team
  // getting a flapping red light every time Supabase ships a new
  // advisor rule.
  if (sec.warns.length || sec.infos.length) {
    warn(`! Supabase security advisors (informational):`);
    for (const lint of sec.warns) warn(formatLint(lint, "security"));
    for (const lint of sec.infos) warn(formatLint(lint, "security"));
  }
  if (perf.warns.length || perf.infos.length) {
    warn(`! Supabase performance advisors (informational):`);
    for (const lint of perf.warns) warn(formatLint(lint, "performance"));
    for (const lint of perf.infos) warn(formatLint(lint, "performance"));
  }

  const errs = [...sec.errors, ...perf.errors];
  if (errs.length === 0) {
    log(
      `✓ check-supabase-advisors: 0 ERROR-level findings (${sec.warns.length + sec.infos.length} security + ${perf.warns.length + perf.infos.length} performance informational)`,
    );
    return {
      ok: true,
      errors: 0,
      warns: sec.warns.length + perf.warns.length,
      infos: sec.infos.length + perf.infos.length,
    };
  }

  error(`✗ check-supabase-advisors: ${errs.length} ERROR-level finding(s)\n`);
  for (const lint of sec.errors) error(formatLint(lint, "security"));
  for (const lint of perf.errors) error(formatLint(lint, "performance"));
  error(
    `\nFix the items above before merging, or document the suppression in the PR body.\nSee https://supabase.com/docs/guides/database/database-advisor for full advisor docs.`,
  );
  return { ok: false, reason: "errors-present", errors: errs.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runAdvisorsCheck({ env: process.env });
  process.exit(result.ok ? 0 : 1);
}
