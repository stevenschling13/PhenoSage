#!/usr/bin/env node
// scripts/check-server-action-exports.mjs
//
// Enforces the React 19 / Next.js 16 contract for files with the
// `"use server"` directive: every value-level export MUST be an async
// function. Non-async exports (e.g. `*InitialState` const objects, sync
// helpers, plain types-as-values, TypeScript enums) make the file
// invalid as a Server Actions module and Next throws at request time
// with:
//
//   Error: A "use server" file can only export async functions, found "<thing>".
//
// In production this surfaces as a 500 on the action POST and renders
// the generic "An error occurred in the Server Components render"
// fallback — the original failure that motivated this script.
//
// What we flag (only inside files whose first non-comment line is
// `"use server"`):
//   - `export const ...`   (objects, primitives, sync arrow functions)
//   - `export let ...`     / `export var ...`
//   - `export function ...` without `async`
//   - `export class ...`   (constructors aren't async)
//   - `export enum ...`    (compiles to a runtime object)
//   - re-exports via `export { x } from "./y"` or `export * from "./y"`
//     (we can't statically prove the re-exported binding is async, and
//     mixing re-exports into a server-actions module is almost always
//     a code-organisation mistake — move the file or split it)
//
// What we allow:
//   - `export async function ...`
//   - `export type ...`        (erased at compile time)
//   - `export interface ...`   (erased at compile time)
//   - blank lines, comments
//
// Run via `pnpm run check:server-actions` (wired into validate).

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
      continue;
    }
    if (st.isFile()) yield full;
  }
}

// First non-empty, non-comment-only line check. The directive must be
// the very first statement of the module (React/Next requirement).
function hasUseServerDirective(source) {
  const lines = source.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) continue;
    return /^["']use server["'];?$/.test(line);
  }
  return false;
}

// Strip block comments + line comments so the export-line regexes don't
// match against documentation. Strings inside comments aren't a concern
// because we only care about top-of-line `export` keywords.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// Per-file scan. Returns an array of human-readable violation strings.
function findNonAsyncExports(source) {
  const violations = [];
  const stripped = stripComments(source);
  const lines = stripped.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip type-only exports — these are erased.
    if (/^\s*export\s+type\s/.test(line)) continue;
    if (/^\s*export\s+interface\s/.test(line)) continue;
    // `export type { ... } from "./..."` re-exports are also erased.
    if (/^\s*export\s+type\s*\{/.test(line)) continue;

    // Allowed: `export async function foo(...)`.
    if (/^\s*export\s+async\s+function\s/.test(line)) continue;

    // Flag the disallowed shapes.
    let kind = null;
    if (/^\s*export\s+const\s/.test(line)) kind = "const";
    else if (/^\s*export\s+let\s/.test(line)) kind = "let";
    else if (/^\s*export\s+var\s/.test(line)) kind = "var";
    else if (/^\s*export\s+function\s/.test(line)) kind = "non-async function";
    else if (/^\s*export\s+class\s/.test(line)) kind = "class";
    else if (/^\s*export\s+enum\s/.test(line)) kind = "enum";
    else if (/^\s*export\s+default\s/.test(line)) kind = "default export";
    else if (
      /^\s*export\s*\{[^}]*\}\s*(from\s+["'].+["']\s*)?;?\s*$/.test(line)
    )
      kind = "named re-export";
    else if (/^\s*export\s*\*\s*from\s+["']/.test(line))
      kind = "namespace re-export";

    if (kind) {
      violations.push(`line ${i + 1}: ${kind} — ${line.trim()}`);
    }
  }

  return violations;
}

let scanned = 0;
for (const file of walk(WEB_SRC)) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  // Test files don't ship to the runtime bundle.
  if (file.includes(`${sep}__tests__${sep}`)) continue;
  if (/\.test\.(ts|tsx)$/.test(file)) continue;
  if (/\.spec\.(ts|tsx)$/.test(file)) continue;

  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!hasUseServerDirective(source)) continue;
  scanned++;

  const violations = findNonAsyncExports(source);
  if (violations.length === 0) continue;

  const rel = relative(ROOT, file);
  errors.push(
    `${rel}:\n` +
      violations.map((v) => `    ${v}`).join("\n") +
      `\n    → Move non-async exports to a sibling file without "use server". ` +
      `See the React 19 / Next 16 rule: "A 'use server' file can only export async functions."`,
  );
}

if (errors.length) {
  console.error("✗ check-server-action-exports: violations\n");
  for (const e of errors) console.error("  - " + e + "\n");
  process.exit(1);
}

console.log(
  `✓ check-server-action-exports: OK (${scanned} "use server" file${scanned === 1 ? "" : "s"} scanned)`,
);
