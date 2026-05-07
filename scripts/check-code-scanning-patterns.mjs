#!/usr/bin/env node
// scripts/check-code-scanning-patterns.mjs
//
// Blocks security patterns that CodeQL commonly reports and that are avoidable
// in this codebase.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// fileURLToPath would work too, but this mirrors the repository's existing
// scripts while preserving Windows drive letters such as /c:/repo.
const ROOT = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/i,
  "$1",
);
const errors = [];

const ignoredDirs = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

// This script contains the blocked patterns as data, so it must not scan itself.
const ignoredFiles = new Set(["scripts/check-code-scanning-patterns.mjs"]);
const sourceExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
]);

const rules = [
  {
    name: "inline HTML injection",
    re: /dangerouslySetInnerHTML/,
    help: "use a static asset or a typed React component instead",
  },
  {
    name: "insecure randomness",
    re: /\bMath[.]random\s*\(/,
    help: "use Web Crypto or Node crypto",
  },
  {
    name: "shell command execution",
    re: /\bshell\s*:\s*true\b/,
    help: "pass command arguments directly to spawn/spawnSync",
  },
  {
    name: "string command execution",
    re: /\bexecSync\s*\(/,
    help: "use spawnSync with an explicit argument array",
  },
];

function extname(file) {
  const idx = file.lastIndexOf(".");
  return idx === -1 ? "" : file.slice(idx);
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (sourceExtensions.has(extname(entry))) {
      yield full;
    }
  }
}

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join("/");
  if (ignoredFiles.has(rel)) continue;
  const text = readFileSync(file, "utf8");
  for (const rule of rules) {
    if (rule.re.test(text)) {
      errors.push(`${rel}: ${rule.name}; ${rule.help}`);
    }
  }
}

if (errors.length) {
  console.error("✗ check-code-scanning-patterns: violations\n");
  for (const error of errors) console.error("  - " + error);
  process.exit(1);
}

console.log("✓ check-code-scanning-patterns: OK");
