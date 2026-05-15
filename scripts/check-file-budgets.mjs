#!/usr/bin/env node
// scripts/check-file-budgets.mjs
//
// Per-file line-count budgets. Forces a focused refactor before a hot file
// grows past the point where it becomes hard to reason about, hard to
// merge concurrently, and slow for the IDE/tooling to parse.
//
// Budgets are deliberately generous — they exist to prevent runaway
// growth, not to police every PR. When a budget is hit, the right move
// is to split the file (see chat-tools.ts → chat-tool-definitions.ts
// for the pattern); raising the limit should be a last resort and
// explained in the PR body.

import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

// path → max non-empty lines. Test files are exempt by convention
// (they grow with coverage); add them explicitly if a cap is desired.
const BUDGETS = [
  ["apps/web/src/lib/server/chat-tools.ts", 1500],
  ["apps/web/src/lib/server/chat-tool-definitions.ts", 1200],
];

const errors = [];

for (const [rel, max] of BUDGETS) {
  const full = ROOT + rel;
  if (!existsSync(full)) {
    errors.push(`Missing file in budget list: ${rel}`);
    continue;
  }
  const lines = readFileSync(full, "utf8").split("\n").length;
  if (lines > max) {
    errors.push(
      `${rel}: ${lines} lines exceeds budget of ${max}. Split the file (extract pure data, schemas, or per-domain handlers) before adding more.`,
    );
  }
}

if (errors.length) {
  console.error("✗ check-file-budgets: violations\n");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ check-file-budgets: OK");
