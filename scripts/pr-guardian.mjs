#!/usr/bin/env node
// scripts/pr-guardian.mjs
//
// Enforces PR-size discipline. Designed to run as a soft-gate CI step
// and locally before opening a PR.
//
// Limits:
//   - files changed:       30
//   - total lines changed: 1500
//   - single-file growth:  500
//
// Env:
//   BASE  — base branch to diff against (default: origin/main)
//   GUARDIAN_OVERRIDE=1 — bypass (only for humans, never in automation).
//
// Exit codes:
//   0 — within caps (or override set)
//   1 — over a cap; prints a table

import { execSync } from "node:child_process";

const BASE = process.env.BASE || "origin/main";
const LIMIT_FILES = 30;
const LIMIT_TOTAL = 1500;
const LIMIT_FILE = 500;

if (process.env.GUARDIAN_OVERRIDE === "1") {
  console.log("pr-guardian: override set, skipping.");
  process.exit(0);
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

let numstat;
try {
  numstat = sh(`git diff --numstat ${BASE}...HEAD`);
} catch (err) {
  console.error(`pr-guardian: failed to diff against ${BASE}`);
  console.error(String(err));
  process.exit(0); // don't break CI on diff failure
}

if (!numstat) {
  console.log("pr-guardian: no changes vs", BASE);
  process.exit(0);
}

const rows = numstat
  .split("\n")
  .map((line) => {
    const [added, removed, path] = line.split("\t");
    const a = added === "-" ? 0 : Number(added);
    const r = removed === "-" ? 0 : Number(removed);
    return { path, added: a, removed: r, delta: a + r };
  })
  .filter((row) => row.path && !row.path.includes("pnpm-lock.yaml"));

const totalFiles = rows.length;
const totalLines = rows.reduce((s, r) => s + r.delta, 0);
const worst = rows.reduce((w, r) => (r.delta > w.delta ? r : w), {
  path: "",
  delta: 0,
});

const violations = [];
if (totalFiles > LIMIT_FILES) {
  violations.push(`files changed ${totalFiles} > ${LIMIT_FILES}`);
}
if (totalLines > LIMIT_TOTAL) {
  violations.push(`total lines ${totalLines} > ${LIMIT_TOTAL}`);
}
if (worst.delta > LIMIT_FILE) {
  violations.push(
    `single-file growth ${worst.delta} lines in ${worst.path} > ${LIMIT_FILE}`,
  );
}

console.log("pr-guardian:");
console.log(`  base           = ${BASE}`);
console.log(`  files changed  = ${totalFiles} (limit ${LIMIT_FILES})`);
console.log(`  lines changed  = ${totalLines} (limit ${LIMIT_TOTAL})`);
console.log(
  `  worst file     = ${worst.path || "(none)"} @ ${worst.delta} lines (limit ${LIMIT_FILE})`,
);

if (!violations.length) {
  console.log("pr-guardian: OK");
  process.exit(0);
}

console.error("\npr-guardian: violations");
for (const v of violations) console.error("  - " + v);
console.error(
  "\nSplit the PR, or set GUARDIAN_OVERRIDE=1 (reviewers will ask why).",
);
process.exit(1);
