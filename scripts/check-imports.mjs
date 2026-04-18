#!/usr/bin/env node
// scripts/check-imports.mjs
//
// Lightweight import / smoke checks:
//   1. packages/shared must not import from apps/**.
//   2. apps/analysis (Python) must not be referenced from apps/web TS imports.
//   3. No accidental imports from "@supabase/supabase-js" inside client components
//      with the service role key — caught indirectly via check-route-boundaries,
//      but we also flag direct Supabase admin client imports outside server libs.
//   4. Required entry files exist.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const errors = [];

function* walk(dir, exts) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
      yield* walk(full, exts);
    } else if (exts.some((e) => entry.endsWith(e))) {
      yield full;
    }
  }
}

// 1. packages/shared must not import from apps/
const sharedDir = join(ROOT, "packages", "shared", "src");
for (const f of walk(sharedDir, [".ts", ".tsx"])) {
  const text = readFileSync(f, "utf8");
  if (/from\s+["'](?:\.\.\/)+apps\//.test(text) || /from\s+["']@\/apps\//.test(text)) {
    errors.push(`packages/shared imports from apps/: ${relative(ROOT, f).split(sep).join("/")}`);
  }
}

// 2. apps/web must not import from apps/analysis
const webSrc = join(ROOT, "apps", "web", "src");
for (const f of walk(webSrc, [".ts", ".tsx"])) {
  const text = readFileSync(f, "utf8");
  if (/from\s+["'](?:\.\.\/)+analysis\//.test(text) || /from\s+["'].*apps\/analysis/.test(text)) {
    errors.push(`apps/web imports from apps/analysis: ${relative(ROOT, f).split(sep).join("/")}`);
  }
}

// 3. createClient(...) with service role outside server libs
const SERVER_OK = [/apps[\\/]web[\\/]src[\\/]lib[\\/]server[\\/]/, /scripts[\\/]/];
for (const f of walk(webSrc, [".ts", ".tsx"])) {
  const rel = relative(ROOT, f).split(sep).join("/");
  if (SERVER_OK.some((p) => p.test(rel))) continue;
  const text = readFileSync(f, "utf8");
  if (/SUPABASE_SERVICE_ROLE_KEY/.test(text)) {
    errors.push(`SUPABASE_SERVICE_ROLE_KEY referenced outside server libs: ${rel}`);
  }
}

// 4. Required files exist
const required = [
  "apps/web/src/app/layout.tsx",
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/api/health/route.ts",
  "apps/web/src/lib/server/auth.ts",
  "apps/web/src/lib/server/db.ts",
  "apps/web/src/lib/server/storage.ts",
  "apps/web/src/lib/server/analysis-proxy.ts",
  "apps/analysis/app/main.py",
  "apps/analysis/app/routers/health.py",
  "apps/analysis/app/routers/analyze.py",
  "packages/shared/src/types.ts",
  "supabase/migrations/001_initial_schema.sql",
];
for (const r of required) {
  if (!existsSync(join(ROOT, ...r.split("/")))) {
    errors.push(`Missing required file: ${r}`);
  }
}

if (errors.length) {
  console.error("✗ check-imports: violations\n");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ check-imports: OK");
