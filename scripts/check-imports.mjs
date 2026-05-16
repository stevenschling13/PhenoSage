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

const ROOT = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

const errors = [];

function* walk(dir, exts) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist")
        continue;
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
  if (
    /from\s+["'](?:\.\.\/)+apps\//.test(text) ||
    /from\s+["']@\/apps\//.test(text)
  ) {
    errors.push(
      `packages/shared imports from apps/: ${relative(ROOT, f).split(sep).join("/")}`,
    );
  }
}

// 2. apps/web must not import from apps/analysis
const webSrc = join(ROOT, "apps", "web", "src");
for (const f of walk(webSrc, [".ts", ".tsx"])) {
  const text = readFileSync(f, "utf8");
  if (
    /from\s+["'](?:\.\.\/)+analysis\//.test(text) ||
    /from\s+["'].*apps\/analysis/.test(text)
  ) {
    errors.push(
      `apps/web imports from apps/analysis: ${relative(ROOT, f).split(sep).join("/")}`,
    );
  }
}

// 3. createClient(...) with service role outside server libs
//
// We look for ACTUAL env access (`process.env.SUPABASE_SERVICE_ROLE_KEY` or
// `process.env["SUPABASE_SERVICE_ROLE_KEY"]`), not bare string mentions of
// the name. Route handlers, error classifiers, diagnostic endpoints, and
// CSPs all have legitimate reasons to mention the name (e.g. inside a regex
// that classifies upstream error messages — see the chat route's top-level
// catch). Flagging those would either force ugly indirection or push real
// security signal into the noise.
const SERVER_OK = [
  /apps[\\/]web[\\/]src[\\/]lib[\\/]server[\\/]/,
  /scripts[\\/]/,
];
const SERVICE_ROLE_ACCESS_RE =
  /process\.env(?:\.SUPABASE_SERVICE_ROLE_KEY\b|\[\s*["']SUPABASE_SERVICE_ROLE_KEY["']\s*\])/;
for (const f of walk(webSrc, [".ts", ".tsx"])) {
  const rel = relative(ROOT, f).split(sep).join("/");
  if (SERVER_OK.some((p) => p.test(rel))) continue;
  const text = readFileSync(f, "utf8");
  if (SERVICE_ROLE_ACCESS_RE.test(text)) {
    errors.push(
      `SUPABASE_SERVICE_ROLE_KEY accessed outside server libs: ${rel}`,
    );
  }
}

// 4b. Next 16 contract: any file beginning with `"use server"` may only
//     export async functions. Exporting a `const`, `let`, `var`, `class`,
//     or non-async `function` triggers `Error: A "use server" file can
//     only export async functions, found object` at every server-action
//     POST. Type-only exports (`export type`, `export interface`,
//     `export type {...}`) are erased by SWC and stay safe.
//
//     This guardrail caught the May 15 2026 production audit's create-
//     grow + settings outages — the InitialState constants used to live
//     next to the actions and only blew up at runtime. Now drift is
//     caught locally before it ships.
//
//     The regex deliberately matches at column 0 only: indented exports
//     are inside a function or block and are not module-level.
const USE_SERVER_RE = /^\s*["']use server["'];?\s*$/m;
const NON_ASYNC_EXPORT_RE =
  /^export\s+(?:const|let|var|enum|class)\s+([A-Za-z_$][\w$]*)/gm;
const NON_ASYNC_FUNCTION_EXPORT_RE =
  /^export\s+function\s+([A-Za-z_$][\w$]*)/gm;
for (const f of walk(webSrc, [".ts", ".tsx"])) {
  const text = readFileSync(f, "utf8");
  // Only inspect files whose top of the module is "use server".
  // (Function-level "use server" inline directives don't pose this
  // hazard — only file-level ones do.)
  const head = text.slice(0, 200);
  if (!USE_SERVER_RE.test(head)) continue;
  const rel = relative(ROOT, f).split(sep).join("/");
  let m;
  NON_ASYNC_EXPORT_RE.lastIndex = 0;
  while ((m = NON_ASYNC_EXPORT_RE.exec(text)) !== null) {
    errors.push(
      `"use server" file exports non-async value (Next 16 will throw at runtime): ${rel} → ${m[1]}`,
    );
  }
  NON_ASYNC_FUNCTION_EXPORT_RE.lastIndex = 0;
  while ((m = NON_ASYNC_FUNCTION_EXPORT_RE.exec(text)) !== null) {
    // `export async function` is fine; `export function` is not.
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const line = text.slice(lineStart, m.index + m[0].length + 6);
    if (!/export\s+async\s+function/.test(line)) {
      errors.push(
        `"use server" file exports non-async function (Next 16 will throw at runtime): ${rel} → ${m[1]}`,
      );
    }
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
