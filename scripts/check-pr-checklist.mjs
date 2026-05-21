#!/usr/bin/env node
// Pure helper that parses a PR body and decides whether the required
// pre-deploy checklists are complete.
//
// Required sections (matched against `.github/PULL_REQUEST_TEMPLATE.md`):
//
//   1. "## Validation"
//      - All `- [ ]` items must be checked, EXCEPT the final one whose text
//        starts with "(If " (conditional on a path change).
//
//   2. "## Architecture & Forbidden Changes"
//      - All `- [ ]` items must be checked (unconditional).
//
//   3. "## Rollback"
//      - At least one `- [ ]` item must be checked.
//
// Returns: { ok: boolean, missing: Array<{section, item}>, summary: string }
//
// Exported as `evaluate(body)` for use by the workflow (via github-script)
// and by tests under scripts/__tests__/.

const SECTION_RE = (heading) =>
  new RegExp(
    `^##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=^##\\s|\\z)`,
    "im",
  );

// Match list items, capturing the box state and the item text on the same
// line. Allows leading whitespace.
const ITEM_RE = /^\s*[-*]\s*\[( |x|X)\]\s+(.+?)\s*$/;

function extractSection(body, heading) {
  const match = body.match(SECTION_RE(heading));
  return match ? match[1] : null;
}

function parseItems(section) {
  if (!section) return [];
  return section
    .split("\n")
    .map((line) => line.match(ITEM_RE))
    .filter(Boolean)
    .map((m) => ({ checked: m[1].toLowerCase() === "x", text: m[2] }));
}

export function evaluate(body) {
  const missing = [];
  const sectionsFound = [];

  // --- Validation ---------------------------------------------------------
  const validation = extractSection(body, "Validation");
  if (!validation) {
    missing.push({
      section: "Validation",
      item: "(section missing from PR body)",
    });
  } else {
    sectionsFound.push("Validation");
    const items = parseItems(validation);
    for (const it of items) {
      // The template's last validation row is conditional on apps/analysis
      // changing. Skip it if it begins with "(If ".
      if (/^\(If\b/i.test(it.text)) continue;
      if (!it.checked) {
        missing.push({ section: "Validation", item: it.text });
      }
    }
  }

  // --- Architecture & Forbidden Changes ----------------------------------
  const arch = extractSection(body, "Architecture & Forbidden Changes");
  if (!arch) {
    missing.push({
      section: "Architecture & Forbidden Changes",
      item: "(section missing from PR body)",
    });
  } else {
    sectionsFound.push("Architecture & Forbidden Changes");
    for (const it of parseItems(arch)) {
      if (!it.checked) {
        missing.push({
          section: "Architecture & Forbidden Changes",
          item: it.text,
        });
      }
    }
  }

  // --- Rollback (at least one checked) -----------------------------------
  const rollback = extractSection(body, "Rollback");
  if (!rollback) {
    missing.push({
      section: "Rollback",
      item: "(section missing from PR body)",
    });
  } else {
    sectionsFound.push("Rollback");
    const items = parseItems(rollback);
    if (items.length > 0 && !items.some((it) => it.checked)) {
      missing.push({
        section: "Rollback",
        item: "at least one rollback strategy must be checked",
      });
    }
  }

  const ok = missing.length === 0;
  const summary = ok
    ? `Pre-deploy checklist: all required items checked (${sectionsFound.join(", ")}).`
    : [
        "Pre-deploy checklist: required items unchecked.",
        "",
        ...missing.map((m) => `- **${m.section}**: ${m.item}`),
        "",
        "Edit the PR body and check the items, or add the `guardian:approved` label to waive.",
      ].join("\n");

  return { ok, missing, summary };
}

// CLI entry: read PR body from stdin, exit 0/1 with summary on stdout.
// Used only for local debugging; CI calls evaluate() via github-script.
if (import.meta.url === `file://${process.argv[1]}`) {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    body += chunk;
  });
  process.stdin.on("end", () => {
    const result = evaluate(body);
    process.stdout.write(`${result.summary}\n`);
    process.exit(result.ok ? 0 : 1);
  });
}
