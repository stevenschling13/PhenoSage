#!/usr/bin/env node
// Guardrail: every third-party (non-github/non-actions) GitHub Action used in
// .github/workflows/** must be pinned to a 40-char commit SHA, optionally
// followed by a `# vX.Y.Z` comment. CodeQL/Scorecard flag tag-pinned third-party
// Actions because tags are mutable. New violations fail this check; pre-existing
// references that have not been pinned yet are tracked in LEGACY_ALLOWLIST so
// the guardrail can be tightened incrementally without breaking unrelated CI.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS_DIR = ".github/workflows";

// First-party orgs whose Actions are conventionally allowed unpinned.
const FIRST_PARTY_ORGS = new Set(["actions", "github"]);

// Pre-existing tag-pinned references that pre-date this guardrail.
// Format: "owner/repo@ref" exactly as written in YAML. Drive this list to
// empty by pinning each entry to a SHA.
const LEGACY_ALLOWLIST = new Set([
  "ossf/scorecard-action@v2.4.3",
  "dependabot/fetch-metadata@v3",
  "step-security/harden-runner@v2",
  "pnpm/action-setup@v6",
  "gitleaks/gitleaks-action@v2",
  "supabase/setup-cli@v1",
]);

const SHA_RE = /^[0-9a-f]{40}$/;
const USES_RE = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/;

function listYamlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listYamlFiles(full));
    } else if (/\.ya?ml$/i.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
for (const file of listYamlFiles(WORKFLOWS_DIR)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, idx) => {
    const match = line.match(USES_RE);
    if (!match) return;
    const ref = match[1];
    // Skip docker:// and local ./ references.
    if (ref.startsWith("docker://") || ref.startsWith("./")) return;
    const at = ref.lastIndexOf("@");
    if (at === -1) return;
    const repo = ref.slice(0, at);
    const version = ref.slice(at + 1);
    const org = repo.split("/")[0];
    if (FIRST_PARTY_ORGS.has(org)) return;
    if (SHA_RE.test(version)) return;
    if (LEGACY_ALLOWLIST.has(ref)) return;
    violations.push({ file, line: idx + 1, ref });
  });
}

if (violations.length > 0) {
  console.error("✗ check-action-pins: unpinned third-party Action(s) detected");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.ref}`);
  }
  console.error("");
  console.error(
    "Pin each to a 40-char commit SHA (with a `# vX.Y.Z` comment), or, if you",
  );
  console.error(
    "are not the author of this reference, add it to LEGACY_ALLOWLIST in",
  );
  console.error("scripts/check-action-pins.mjs and open a follow-up to pin it.");
  process.exit(1);
}

console.log("✓ check-action-pins: OK");
