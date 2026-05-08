#!/usr/bin/env node
// scripts/check-production-readiness-gates.mjs
//
// Fails when known placeholder handlers or missing critical execution branches
// are detected in production runtime route/service modules.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const RUNTIME_TODO_ALLOWLIST_PATHS = [
  /^docs\//,
  /\/__tests__\//,
  /\/tests\//,
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
];

const sourceExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
]);
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

const runtimeRoots = [
  "apps/web/src/app/api",
  "apps/web/src/lib/server",
  "apps/analysis/app/services",
];

const criticalBranchRules = [
  {
    file: "apps/web/src/app/api/chat/route.ts",
    required: [
      { name: "auth guard", test: /getServerSession\s*\(/ },
      { name: "unauthorized return", test: /status:\s*401/ },
      { name: "message validation", test: /message\s+is\s+required/ },
      { name: "streaming response", test: /ReadableStream/ },
    ],
  },
  {
    file: "apps/web/src/app/api/internal/cron/daily-summary/route.ts",
    required: [
      { name: "cron authorization header check", test: /authorization/ },
      { name: "cron secret validation", test: /CRON_SECRET/ },
      { name: "unauthorized return", test: /status:\s*401/ },
    ],
  },
  {
    file: "apps/analysis/app/services/image_comparison.py",
    required: [
      {
        name: "comparison function",
        test: /async\s+def\s+compare_images\s*\(/,
      },
      {
        name: "non-placeholder return",
        test: /return\s+(?!["']Image comparison not yet implemented\.)/,
      },
    ],
  },
];

const placeholderPatterns = [
  { name: "todo marker", re: /\bTODO\b/i },
  { name: "not implemented placeholder", re: /\bnot yet implemented\b/i },
  { name: "todo response payload", re: /message\s*:\s*["']TODO:/i },
  { name: "placeholder string", re: /\bplaceholder\b/i },
];

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

function isAllowlistedTodoPath(rel) {
  return RUNTIME_TODO_ALLOWLIST_PATHS.some((rule) => rule.test(rel));
}

const errors = [];

for (const file of criticalBranchRules) {
  const fullPath = join(ROOT, file.file);
  if (!existsSync(fullPath)) {
    errors.push(
      `${file.file}: missing critical runtime endpoint/service module`,
    );
    continue;
  }

  const text = readFileSync(fullPath, "utf8");

  for (const requirement of file.required) {
    if (!requirement.test.test(text)) {
      errors.push(
        `${file.file}: missing required execution branch (${requirement.name})`,
      );
    }
  }
}

for (const root of runtimeRoots) {
  for (const full of walk(join(ROOT, root))) {
    const rel = relative(ROOT, full).split(sep).join("/");
    if (isAllowlistedTodoPath(rel)) continue;

    const text = readFileSync(full, "utf8");
    for (const pattern of placeholderPatterns) {
      if (pattern.re.test(text)) {
        errors.push(
          `${rel}: disallowed ${pattern.name} found in runtime module`,
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error("✗ check-production-readiness-gates: violations\n");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log("✓ check-production-readiness-gates: OK");
