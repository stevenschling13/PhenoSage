#!/usr/bin/env node
// scripts/check-migration-parity.mjs
//
// Compares the migration files in supabase/migrations/ against the list
// returned by `supabase migration list --linked` and reports any drift:
//
//   * Local files not yet applied to the linked database (pending)
//   * Applied migrations whose local file is missing (orphans — indicates
//     a migration was applied directly without a matching committed file,
//     or a file was deleted after apply, both of which are forbidden).
//
// Prerequisites:
//   * SUPABASE_ACCESS_TOKEN env var (Supabase personal / CI token)
//   * SUPABASE_PROJECT_REF  env var (production project ref)
//   * SUPABASE_DB_PASSWORD  env var (required by `supabase db push`)
//   * Supabase CLI installed (supabase/setup-cli action handles this in CI)
//
// Exit codes:
//   0 — schema is in sync (no pending or orphaned migrations)
//   1 — drift detected, or prerequisites missing, or CLI call failed
//
// This script is intentionally NOT included in `pnpm run validate` because
// it requires network access and Supabase credentials. It is called by
// `.github/workflows/migration-parity.yml` on a nightly schedule.

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

// ── 1. Prerequisite checks ───────────────────────────────────────────────────

const missing = [];
for (const v of [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_PASSWORD",
]) {
  if (!process.env[v]) missing.push(v);
}
if (missing.length) {
  console.error(
    `✗ check-migration-parity: missing required env vars: ${missing.join(", ")}`,
  );
  process.exit(1);
}

if (!existsSync(MIGRATIONS_DIR)) {
  console.error(
    `✗ check-migration-parity: supabase/migrations/ not found at ${MIGRATIONS_DIR}`,
  );
  process.exit(1);
}

// ── 2. Link the Supabase project ─────────────────────────────────────────────

const projectRef = process.env.SUPABASE_PROJECT_REF;
// Validate ref format before passing to CLI to prevent injection.
if (!/^[a-z0-9]+$/.test(projectRef)) {
  console.error(
    "✗ check-migration-parity: SUPABASE_PROJECT_REF contains unexpected characters",
  );
  process.exit(1);
}

console.log(`Linking Supabase project ${projectRef} …`);
const linkResult = spawnSync(
  "supabase",
  ["link", "--project-ref", projectRef],
  { encoding: "utf8", stdio: "pipe" },
);
if (linkResult.status !== 0) {
  console.error("✗ check-migration-parity: supabase link failed");
  console.error(linkResult.stderr || linkResult.stdout);
  process.exit(1);
}

// ── 3. List applied migrations from production ───────────────────────────────

console.log("Fetching applied migrations from production …");
const listResult = spawnSync("supabase", ["migration", "list", "--linked"], {
  encoding: "utf8",
  stdio: "pipe",
});
if (listResult.status !== 0) {
  console.error("✗ check-migration-parity: supabase migration list failed");
  console.error(listResult.stderr || listResult.stdout);
  process.exit(1);
}

// `supabase migration list` output format (as of CLI v2):
//
//   LOCAL      │ REMOTE    │ TIME (UTC)
//   ────────────┼───────────┼───────────────────────────
//   20230101    │ 20230101  │ 2023-01-01 12:00:00+00
//   20230102    │           │
//              │ 20230103  │ 2023-01-03 08:00:00+00
//
// OR (older CLI format without header):
//   001_initial_schema      applied
//   002_storage_buckets     applied
//   003_production_optim…   pending
//
// We parse both formats conservatively: extract version tokens and classify.

const rawOutput = listResult.stdout;

// ── 4. Collect local migration file versions ──────────────────────────────────

// Local files follow the pattern NNN_description.sql (3+ digit prefix)
// or the timestamp format YYYYMMDDHHmmss_description.sql.
const localFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort();

// Normalise version: strip description, keep leading numeric portion.
const versionOf = (name) => name.replace(/_.*$/, "");

const localVersions = new Set(localFiles.map(versionOf));

// ── 5. Parse the CLI output for applied / pending state ──────────────────────

// Strategy: look for lines that have a 3-digit or 14-digit version token,
// then check whether both LOCAL and REMOTE columns are populated (applied)
// or only one side is populated (pending / orphan).
//
// The new table format: each row has a LOCAL column and a REMOTE column.
// An applied migration appears in both columns.
// A pending local migration appears only in LOCAL.
// An orphan applied-on-remote appears only in REMOTE.

const appliedOnRemote = new Set();
const pendingLocal = new Set();

// Match version tokens: 3-digit numeric (001) or 14-digit timestamp (20260101120000)
const TOKEN_RE = /\b(\d{3}|\d{14})\b/g;

for (const line of rawOutput.split("\n")) {
  // Skip header/divider lines
  if (!TOKEN_RE.test(line)) {
    TOKEN_RE.lastIndex = 0;
    continue;
  }
  TOKEN_RE.lastIndex = 0;

  const tokens = [...line.matchAll(/\b(\d{3}|\d{14})\b/g)].map((m) => m[1]);
  if (tokens.length === 0) continue;

  // Old format: trailing "applied" / "pending" keyword
  if (/\bapplied\b/i.test(line)) {
    tokens.forEach((t) => appliedOnRemote.add(t));
    continue;
  }
  if (/\bpending\b/i.test(line)) {
    tokens.forEach((t) => pendingLocal.add(t));
    continue;
  }

  // New table format: LOCAL | REMOTE | TIME
  // Split on the column separator (│ or |)
  const cols = line.split(/[│|]/).map((c) => c.trim());
  if (cols.length >= 2) {
    const localCol = cols[0];
    const remoteCol = cols[1];
    const localToken = localCol.match(/\b(\d{3}|\d{14})\b/)?.[1];
    const remoteToken = remoteCol.match(/\b(\d{3}|\d{14})\b/)?.[1];
    if (localToken && remoteToken) {
      appliedOnRemote.add(remoteToken);
    } else if (localToken && !remoteToken) {
      pendingLocal.add(localToken);
    } else if (!localToken && remoteToken) {
      // Remote-only: orphan
      appliedOnRemote.add(remoteToken);
    }
  }
}

// ── 6. Compute drift ─────────────────────────────────────────────────────────

// Pending: local file exists but not yet applied to production.
const pending = localFiles.filter((f) => {
  const v = versionOf(f);
  return !appliedOnRemote.has(v);
});

// Orphans: applied on remote but no matching local file.
const orphans = [...appliedOnRemote].filter((v) => !localVersions.has(v));

const hasDrift = pending.length > 0 || orphans.length > 0;

// ── 7. Report ────────────────────────────────────────────────────────────────

if (!hasDrift) {
  console.log(
    `✓ check-migration-parity: all ${localFiles.length} local migration(s) are applied; no orphans.`,
  );
  process.exit(0);
}

console.error("✗ check-migration-parity: schema drift detected\n");

if (pending.length > 0) {
  console.error(
    `  PENDING (${pending.length}) — local files not yet applied to production:`,
  );
  for (const f of pending) console.error(`    - supabase/migrations/${f}.sql`);
  console.error(
    "\n  → Run the 'Database migrations' workflow with dry_run=false to apply.",
  );
}

if (orphans.length > 0) {
  console.error(
    `\n  ORPHAN (${orphans.length}) — applied on production but no matching local file:`,
  );
  for (const v of orphans) console.error(`    - version ${v}`);
  console.error(
    "\n  → An orphan means a migration was applied directly without a committed SQL file,",
  );
  console.error(
    "    or a local file was deleted after apply. Both are forbidden.",
  );
  console.error(
    "    Recover by adding a matching NNN_description.sql file and committing it,",
  );
  console.error(
    "    then re-running this check. Do NOT edit or delete the applied migration.",
  );
}

process.exit(1);
