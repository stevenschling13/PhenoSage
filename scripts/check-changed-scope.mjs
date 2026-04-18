#!/usr/bin/env node
// scripts/check-changed-scope.mjs
//
// Encourages small, bounded PRs and warns when a change crosses too many
// architectural boundaries without explicit acknowledgement.
//
// Usage:
//   node scripts/check-changed-scope.mjs                 # diff vs origin/main
//   node scripts/check-changed-scope.mjs --base=HEAD~1   # diff vs a ref
//   BASE_REF=main node scripts/check-changed-scope.mjs
//
// Exits 0 (passes) but prints a structured summary. Set STRICT=1 to fail
// when the boundary count exceeds the soft cap.

import { execSync } from "node:child_process";

const SOFT_FILE_CAP = 20;
const SOFT_BOUNDARY_CAP = 3;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const baseRef =
  args.base || process.env.BASE_REF || "origin/main";

let diff = "";
try {
  diff = execSync(`git diff --name-only ${baseRef}...HEAD`, { encoding: "utf8" });
} catch {
  try {
    diff = execSync(`git diff --name-only ${baseRef}`, { encoding: "utf8" });
  } catch {
    console.log(`(check-changed-scope) Could not diff against ${baseRef}; skipping.`);
    process.exit(0);
  }
}

const files = diff.split("\n").map((s) => s.trim()).filter(Boolean);

const BOUNDARIES = [
  { name: "shared-types", re: /^packages\/shared\// },
  { name: "supabase-migrations", re: /^supabase\/migrations\// },
  { name: "web-route-handlers", re: /^apps\/web\/src\/app\/api\// },
  { name: "web-server-libs", re: /^apps\/web\/src\/lib\/server\// },
  { name: "web-client", re: /^apps\/web\/src\/app\/(?!api\/).*\.(ts|tsx)$/ },
  { name: "analysis-models", re: /^apps\/analysis\/app\/models\// },
  { name: "analysis-routers", re: /^apps\/analysis\/app\/routers\// },
  { name: "analysis-services", re: /^apps\/analysis\/app\/services\// },
  { name: "ci-config", re: /^\.github\// },
  { name: "scripts", re: /^scripts\// },
  { name: "docs", re: /^docs\// },
];

const hit = new Map();
for (const f of files) {
  for (const b of BOUNDARIES) {
    if (b.re.test(f)) {
      hit.set(b.name, (hit.get(b.name) || 0) + 1);
    }
  }
}

console.log(`Changed-scope summary (base: ${baseRef})`);
console.log(`  Files changed: ${files.length}`);
console.log(`  Boundaries touched: ${hit.size}`);
for (const [b, c] of hit) console.log(`    - ${b}: ${c}`);

const overFiles = files.length > SOFT_FILE_CAP;
const overBoundaries = hit.size > SOFT_BOUNDARY_CAP;

if (overFiles || overBoundaries) {
  const msg =
    `\nWarning: change is broad (${files.length} files, ${hit.size} boundaries). ` +
    `Soft caps: ${SOFT_FILE_CAP} files, ${SOFT_BOUNDARY_CAP} boundaries. ` +
    `Consider splitting this PR. See docs/playbooks/repo-aware-ai-coding-playbook.md.`;
  if (process.env.STRICT === "1") {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
}

console.log("✓ check-changed-scope: done");
