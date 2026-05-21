#!/usr/bin/env node
// scripts/check-route-boundaries.mjs
//
// Enforces server/client boundaries in apps/web:
//   1. Files importing from "@/lib/server/**" or "server-only" must NOT contain "use client".
//   2. Client components ("use client") must NOT import from @/lib/server/**.
//   3. Route Handlers (apps/web/src/app/api/**/route.ts) must NOT have "use client".
//   4. No fetch() to *.railway.app from any client-component file.
//   5. No middleware.ts or proxy.ts file (boundary is owned by Route Handlers).
//      Next 16 renamed `middleware` to `proxy`; both are blocked.
//
// Run via `pnpm run check:routes`.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const WEB_SRC = join(ROOT, "apps", "web", "src");

const errors = [];

function* walk(dir) {
  if (!existsSync(dir)) return;
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

const SERVER_IMPORT_RE =
  /from\s+["'](?:@\/lib\/server\/[^"']+|server-only)["']/;
const USE_CLIENT_RE = /^\s*["']use client["']/m;
const RAILWAY_FETCH_RE = /https?:\/\/[^"'\s]*\.railway\.app/;

let scanned = 0;
for (const file of walk(WEB_SRC)) {
  scanned++;
  const rel = relative(ROOT, file).split(sep).join("/");
  const text = readFileSync(file, "utf8");
  const isClient = USE_CLIENT_RE.test(text);
  const importsServer = SERVER_IMPORT_RE.test(text);

  if (isClient && importsServer) {
    errors.push(`Client component imports server-only module: ${rel}`);
  }
  if (importsServer && /\b["']use client["']/.test(text) === false) {
    // ok, server context
  }
  if (rel.includes("/api/") && rel.endsWith("/route.ts") && isClient) {
    errors.push(`Route Handler must not be a client component: ${rel}`);
  }
  if (isClient && RAILWAY_FETCH_RE.test(text)) {
    errors.push(`Client component fetches Railway URL directly: ${rel}`);
  }
}

// 5. No middleware.ts OR proxy.ts in apps/web
//
// Next 16 renamed the `middleware` filename to `proxy` (Node-runtime only).
// Both are equivalent backend-proxy escape hatches that violate the
// "boundary lives in Route Handlers" rule — block both names so the
// guardrail keeps working on Next 16+.
const forbiddenBoundaryFiles = [
  join(WEB_SRC, "middleware.ts"),
  join(WEB_SRC, "middleware.tsx"),
  join(ROOT, "apps", "web", "middleware.ts"),
  join(WEB_SRC, "proxy.ts"),
  join(WEB_SRC, "proxy.tsx"),
  join(ROOT, "apps", "web", "proxy.ts"),
];
for (const mp of forbiddenBoundaryFiles) {
  if (existsSync(mp)) {
    errors.push(
      `Forbidden file: ${relative(ROOT, mp).split(sep).join("/")} — backend boundary lives in Route Handlers, not middleware/proxy.`,
    );
  }
}

if (errors.length) {
  console.error("✗ check-route-boundaries: violations\n");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ check-route-boundaries: OK (${scanned} files scanned)`);
