#!/usr/bin/env node
// scripts/check-env-contract.mjs
//
// Enforces the env contract:
//  1. Every var declared in the canonical contract must exist in the matching .env.example
//  2. Server-only var names must NEVER appear in any client-shipped code path
//     (client component or non-server lib in apps/web/src/**)
//  3. NEXT_PUBLIC_* names must never hold known-secret tokens
//
// Exits non-zero on violations. Run via `pnpm run check:env`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

// ─── Canonical env contract ────────────────────────────────────────────────
// Public = shipped to browser. Server = must never appear in client code.
// Ops = root-only local/CI workflow vars (CLI, MCP, build-time observability);
//       not consumed by apps/web runtime so they don't belong in
//       apps/web/.env.example, but must still be documented in the root
//       example so contributors know they exist.
const PUBLIC_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_APP_ENV",
];

const SERVER_VARS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEMINI_API_KEY",
  "ANALYSIS_SERVICE_URL",
  "ANALYSIS_SERVICE_API_KEY",
  "ANALYSIS_SERVICE_TIMEOUT_MS",
  "READINESS_PROBE_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "CRON_SECRET",
  "SENTRY_DSN",
  "SENTRY_TRACES_SAMPLE_RATE",
];

const OPS_VARS = [
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_DB_URL",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "SENTRY_AUTH_TOKEN",
  "OTEL_ENABLED",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_SERVICE_NAME",
];

const ANALYSIS_VARS = [
  "ANALYSIS_SERVICE_API_KEY",
  "READINESS_PROBE_SECRET",
  "ALLOWED_ORIGINS",
];

// Files where server-only env reads ARE allowed.
const SERVER_ALLOWED_PATTERNS = [
  /apps[\\/]web[\\/]src[\\/]lib[\\/]server[\\/]/,
  /apps[\\/]web[\\/]src[\\/]app[\\/]api[\\/]/,
  /scripts[\\/]/,
];

const errors = [];

function readEnvExample(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    errors.push(`Missing env example file: ${path}`);
    return "";
  }
}

function assertVarsPresent(file, contents, vars) {
  for (const v of vars) {
    const re = new RegExp(`^\\s*${v}\\s*=`, "m");
    if (!re.test(contents)) {
      errors.push(`Env contract: ${v} missing from ${file}`);
    }
  }
}

// 1. Validate .env.example files
const rootEnv = readEnvExample(join(ROOT, ".env.example"));
assertVarsPresent(".env.example", rootEnv, [
  ...PUBLIC_VARS,
  ...SERVER_VARS,
  ...OPS_VARS,
]);

const webEnv = readEnvExample(join(ROOT, "apps", "web", ".env.example"));
assertVarsPresent("apps/web/.env.example", webEnv, [
  ...PUBLIC_VARS,
  ...SERVER_VARS,
]);

const analysisEnv = readEnvExample(
  join(ROOT, "apps", "analysis", ".env.example"),
);
assertVarsPresent("apps/analysis/.env.example", analysisEnv, ANALYSIS_VARS);

// 2. Walk apps/web/src and ensure server-only vars only appear in allowed paths
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
      yield full;
    }
  }
}

const webSrc = join(ROOT, "apps", "web", "src");
let scannedFiles = 0;
try {
  for (const file of walk(webSrc)) {
    scannedFiles++;
    const rel = relative(ROOT, file).split(sep).join("/");
    const isAllowed = SERVER_ALLOWED_PATTERNS.some((p) => p.test(rel));
    if (isAllowed) continue;

    const text = readFileSync(file, "utf8");
    const isClient = /^\s*["']use client["']/m.test(text);
    for (const v of SERVER_VARS) {
      if (text.includes(v)) {
        errors.push(
          `Server-only env var "${v}" referenced in ${isClient ? "CLIENT " : ""}file ${rel}. ` +
            `Move access into apps/web/src/lib/server/** or a Route Handler.`,
        );
      }
    }
  }
} catch (e) {
  errors.push(`Failed to scan apps/web/src: ${e.message}`);
}

// 3. Sanity: no known secret prefix should be assigned to a NEXT_PUBLIC_* var
const SECRET_PREFIX_RE = /^\s*(NEXT_PUBLIC_\w+)\s*=\s*(sk-|service_role|sbp_)/m;
for (const [label, body] of [
  [".env.example", rootEnv],
  ["apps/web/.env.example", webEnv],
]) {
  const m = body.match(SECRET_PREFIX_RE);
  if (m)
    errors.push(`${label}: ${m[1]} appears to hold a secret value (${m[2]}…)`);
}

if (errors.length) {
  console.error("✗ check-env-contract: violations\n");
  for (const e of errors) console.error("  - " + e);
  console.error(`\nScanned ${scannedFiles} files in apps/web/src.`);
  process.exit(1);
}

console.log(`✓ check-env-contract: OK (${scannedFiles} files scanned)`);
