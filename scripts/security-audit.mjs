#!/usr/bin/env node
// scripts/security-audit.mjs
//
// Aggregate security audit — designed to run before merges to main and
// before production deploys. Chains together:
//   1. Env contract check (server/public split, no-secret-in-NEXT_PUBLIC_)
//   2. Route boundary check (server-only not imported from client)
//   3. Route security check (auth guards, cron secrets)
//   4. Import / smoke check (cross-package imports)
//   5. pnpm audit (npm advisories)
//
// Exits non-zero if any step fails. Writes a markdown summary to stdout.

import { spawnSync } from "node:child_process";

const steps = [
  { name: "env-contract", cmd: "pnpm", args: ["run", "check:env"] },
  { name: "route-boundaries", cmd: "pnpm", args: ["run", "check:routes"] },
  { name: "route-security", cmd: "pnpm", args: ["run", "security:routes"] },
  { name: "imports", cmd: "pnpm", args: ["run", "check:imports"] },
  {
    name: "code-scanning-patterns",
    cmd: "pnpm",
    args: ["run", "check:code-scanning"],
  },
  {
    name: "pnpm audit",
    cmd: "pnpm",
    args: ["audit", "--prod", "--audit-level=high"],
  },
];

const results = [];
let hardFailed = false;

for (const step of steps) {
  const start = Date.now();
  const r = spawnSync(step.cmd, step.args, { stdio: "inherit" });
  const ms = Date.now() - start;
  const ok = r.status === 0;
  if (!ok && step.name !== "pnpm audit") hardFailed = true;
  results.push({ name: step.name, ok, ms });
}

console.log("\n=== security-audit summary ===");
for (const r of results) {
  const tick = r.ok ? "✓" : "✗";
  console.log(`  ${tick} ${r.name.padEnd(18)} ${r.ms}ms`);
}

if (hardFailed) {
  console.error("\nsecurity-audit: one or more hard checks failed");
  process.exit(1);
}
console.log("\nsecurity-audit: OK");
