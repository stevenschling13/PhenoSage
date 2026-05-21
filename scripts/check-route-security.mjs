#!/usr/bin/env node
// scripts/check-route-security.mjs
//
// Audits apps/web/src/app/api/**/route.ts for required security posture:
//   1. Every exported HTTP handler (GET/POST/PUT/PATCH/DELETE) must either
//      (a) be a public route listed in PUBLIC_ROUTES, or
//      (b) reference an auth helper from @/lib/server/auth, or
//      (c) be an /api/internal/* route, which must instead verify the
//          Vercel cron secret, readiness secret, or a webhook signature
//          (header "Authorization: Bearer ..." against CRON_SECRET,
//          VERCEL_CRON_SECRET, READINESS_PROBE_SECRET, or HMAC against
//          ANALYSIS_WEBHOOK_SECRET).
//   2. State-changing routes (POST/PUT/PATCH/DELETE) must read from the
//      request body via .json()/.formData() and not blindly trust query params.
//   3. Route Handlers must not import from "@/components/**" (client leak).
//
// Run via `pnpm run security:routes`.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const API_ROOT = join(ROOT, "apps", "web", "src", "app", "api");

const PUBLIC_ROUTES = new Set([
  // path relative to apps/web/src/app/api, with leading slash
  "/health",
  "/healthz",
  "/ready",
  // Chat diagnostic — returns only build SHA + Gemini-key-alias presence
  // booleans + env-name inventory (no values). Intentionally unauthenticated
  // so an operator can confirm a deployment's chat env from any browser tab
  // without provoking a 500 from /api/chat. See route file header for
  // rationale.
  "/chat/diag",
]);

const errors = [];
const warnings = [];

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (entry === "route.ts" || entry === "route.tsx") {
      yield full;
    }
  }
}

const HTTP_METHOD_RE =
  /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
// Also catch re-exports like `export { GET } from "../health/route"` — these
// expose an HTTP handler at the alias path but the previous regex missed
// them, letting public routes (e.g. /api/healthz) slip past the auth audit.
const HTTP_REEXPORT_RE =
  /\bexport\s*\{\s*([^}]+)\s*\}\s*from\s+["'][^"']+["']/g;
const HTTP_METHOD_NAMES = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const AUTH_IMPORT_RE = /from\s+["']@\/lib\/server\/auth["']/;
const COMPONENTS_IMPORT_RE = /from\s+["']@\/components\//;
const CRON_SECRET_RE =
  /(CRON_SECRET|VERCEL_CRON_SECRET|READINESS_PROBE_SECRET|ANALYSIS_WEBHOOK_SECRET|SUPABASE_AUTH_WEBHOOK_SECRET|SUPABASE_STORAGE_WEBHOOK_SECRET|x-vercel-cron|Vercel-Cron)/;

let scanned = 0;
for (const file of walk(API_ROOT)) {
  scanned++;
  const rel = relative(ROOT, file).split(sep).join("/");
  const apiPath =
    "/" + relative(API_ROOT, file).split(sep).slice(0, -1).join("/");
  const text = readFileSync(file, "utf8");

  if (COMPONENTS_IMPORT_RE.test(text)) {
    errors.push(`${rel}: route imports from @/components (client leak)`);
  }

  const methods = [...text.matchAll(HTTP_METHOD_RE)].map((m) => m[1]);
  for (const reexport of text.matchAll(HTTP_REEXPORT_RE)) {
    const names = reexport[1]
      .split(",")
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/i)
          .pop()
          .trim(),
      )
      .filter((n) => HTTP_METHOD_NAMES.has(n));
    methods.push(...names);
  }
  if (methods.length === 0) continue;

  const isPublic = PUBLIC_ROUTES.has(apiPath);
  const isInternal = apiPath.startsWith("/internal");
  const hasAuth = AUTH_IMPORT_RE.test(text);
  const hasCronGuard = CRON_SECRET_RE.test(text);

  if (isPublic) continue;

  if (isInternal) {
    if (!hasCronGuard) {
      errors.push(
        `${rel}: /api/internal route missing cron/readiness-secret guard (CRON_SECRET/READINESS_PROBE_SECRET/Vercel-Cron header check)`,
      );
    }
    continue;
  }

  if (!hasAuth) {
    errors.push(
      `${rel}: missing auth import (expected "@/lib/server/auth" or addition to PUBLIC_ROUTES in scripts/check-route-security.mjs)`,
    );
  }

  const stateChange = methods.some((m) => m !== "GET");
  if (stateChange) {
    const parsesBody =
      /\.(json|formData|text|arrayBuffer)\s*\(/.test(text) ||
      /\bparseJsonBody\s*\(/.test(text);
    if (!parsesBody) {
      warnings.push(
        `${rel}: state-changing handler (${methods.join(",")}) but no request body parsing detected`,
      );
    }
  }
}

if (warnings.length) {
  console.warn("! check-route-security: advisories\n");
  for (const w of warnings) console.warn("  - " + w);
  console.warn("");
}

if (errors.length) {
  console.error("✗ check-route-security: violations\n");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

console.log(`✓ check-route-security: OK (${scanned} route files scanned)`);
