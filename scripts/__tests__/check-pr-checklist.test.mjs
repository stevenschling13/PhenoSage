import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluate } from "../check-pr-checklist.mjs";

const TEMPLATE = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");

// Tick every `- [ ]` in a body so we can build "fully-checked" fixtures.
function checkAll(body) {
  return body.replace(/- \[ \]/g, "- [x]");
}

test("blank template body fails (everything unchecked)", () => {
  const result = evaluate(TEMPLATE);
  assert.equal(result.ok, false);
  // Validation #1..#4 must all be reported.
  const v = result.missing.filter((m) => m.section === "Validation");
  assert.ok(v.length >= 4, `expected ≥4 Validation misses, got ${v.length}`);
  // Conditional analysis line must NOT be reported.
  assert.ok(
    !v.some((m) => m.item.toLowerCase().startsWith("(if ")),
    "conditional 'If apps/analysis changed' item should be skipped",
  );
  // Architecture & Forbidden block must report all 7 items.
  const a = result.missing.filter(
    (m) => m.section === "Architecture & Forbidden Changes",
  );
  assert.equal(a.length, 7);
  // Rollback must report the "at least one" message.
  const r = result.missing.filter((m) => m.section === "Rollback");
  assert.equal(r.length, 1);
  assert.match(r[0].item, /at least one/);
});

test("fully-checked template body passes", () => {
  const result = evaluate(checkAll(TEMPLATE));
  assert.equal(result.ok, true, result.summary);
  assert.equal(result.missing.length, 0);
});

test("missing required section is flagged", () => {
  const body = checkAll(TEMPLATE).replace(
    /^##\s+Validation[\s\S]*?(?=^##\s)/im,
    "",
  );
  const result = evaluate(body);
  assert.equal(result.ok, false);
  assert.ok(
    result.missing.some(
      (m) => m.section === "Validation" && /section missing/i.test(m.item),
    ),
  );
});

test("rollback passes when exactly one box is checked", () => {
  let body = checkAll(TEMPLATE);
  // Re-uncheck the two non-revert rollback rows; keep "Pure git revert" checked.
  body = body.replace(
    "- [x] Requires migration rollback (describe below)",
    "- [ ] Requires migration rollback (describe below)",
  );
  body = body.replace(
    "- [x] Requires env var rollback (describe below)",
    "- [ ] Requires env var rollback (describe below)",
  );
  const result = evaluate(body);
  assert.equal(result.ok, true, result.summary);
});

test("rollback fails when zero boxes are checked", () => {
  let body = checkAll(TEMPLATE);
  body = body.replace(
    "- [x] Pure `git revert` is sufficient",
    "- [ ] Pure `git revert` is sufficient",
  );
  body = body.replace(
    "- [x] Requires migration rollback (describe below)",
    "- [ ] Requires migration rollback (describe below)",
  );
  body = body.replace(
    "- [x] Requires env var rollback (describe below)",
    "- [ ] Requires env var rollback (describe below)",
  );
  const result = evaluate(body);
  assert.equal(result.ok, false);
  const r = result.missing.filter((m) => m.section === "Rollback");
  assert.equal(r.length, 1);
});

test("summary is informative on failure", () => {
  const result = evaluate(TEMPLATE);
  assert.match(result.summary, /required items unchecked/i);
  assert.match(result.summary, /guardian:approved/);
});

test("summary is concise on success", () => {
  const result = evaluate(checkAll(TEMPLATE));
  assert.match(result.summary, /all required items checked/i);
});
