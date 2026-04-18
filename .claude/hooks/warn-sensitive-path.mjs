#!/usr/bin/env node
// PostToolUse hook: emit an advisory when Edit/Write touches a
// high-risk path. Non-blocking; prints to stderr and exits 0.

import { readFileSync } from "node:fs";

const SENSITIVE = [
  /^supabase\/migrations\//,
  /^packages\/shared\/src\//,
  /^apps\/web\/src\/lib\/server\//,
  /^apps\/web\/next\.config\.(mjs|js|ts)$/,
  /^apps\/web\/middleware\.ts$/,
  /^apps\/analysis\/app\/routers\//,
  /^\.github\/workflows\//,
  /^railway\.toml$/,
  /^apps\/analysis\/railway\.toml$/,
  /^apps\/web\/vercel\.json$/,
];

let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

let event;
try {
  event = JSON.parse(input);
} catch {
  process.exit(0);
}

const filePath =
  event?.tool_input?.file_path ??
  event?.tool_input?.path ??
  event?.tool_input?.filepath ??
  "";
if (!filePath) process.exit(0);

const rel = filePath.replace(/^.*?PhenoSage\//, "");
if (!SENSITIVE.some((re) => re.test(rel))) process.exit(0);

console.error(
  `[phenosage] Sensitive path touched: ${rel}\n` +
    `  → Run \`pnpm validate && pnpm --filter web test\` before committing.`,
);
process.exit(0);
