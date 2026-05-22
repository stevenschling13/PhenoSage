import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyLints,
  formatLint,
  runAdvisorsCheck,
} from "../check-supabase-advisors.mjs";

// ─── classifyLints (pure) ─────────────────────────────────────────────────

test("classifyLints: empty input yields three empty arrays", () => {
  const result = classifyLints([]);
  assert.deepEqual(result, { errors: [], warns: [], infos: [] });
});

test("classifyLints: tolerates non-array input (defensive)", () => {
  assert.deepEqual(classifyLints(undefined), {
    errors: [],
    warns: [],
    infos: [],
  });
  assert.deepEqual(classifyLints(null), {
    errors: [],
    warns: [],
    infos: [],
  });
  assert.deepEqual(classifyLints("not an array"), {
    errors: [],
    warns: [],
    infos: [],
  });
});

test("classifyLints: buckets ERROR/WARN/INFO and tolerates legacy WARNING alias", () => {
  const lints = [
    { name: "a", level: "ERROR" },
    { name: "b", level: "WARN" },
    { name: "c", level: "INFO" },
    { name: "d", level: "warning" }, // legacy alias
    { name: "e", level: "error" }, // case-insensitive
    { name: "f" }, // missing level — falls through to INFO bucket
  ];
  const result = classifyLints(lints);
  assert.equal(result.errors.length, 2);
  assert.equal(result.warns.length, 2);
  assert.equal(result.infos.length, 2);
});

test("classifyLints: skips non-object entries silently", () => {
  const result = classifyLints([
    null,
    undefined,
    "garbage",
    42,
    { level: "ERROR" },
  ]);
  assert.equal(result.errors.length, 1);
});

// ─── formatLint ───────────────────────────────────────────────────────────

test("formatLint: includes categories, facing, detail, and remediation when present", () => {
  const formatted = formatLint(
    {
      name: "rls_disabled",
      level: "ERROR",
      title: "RLS Disabled in Public",
      categories: ["SECURITY"],
      facing: "external",
      detail: "Table public.foo has RLS disabled",
      remediation:
        "https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public",
    },
    "security",
  );
  assert.match(formatted, /\[security\]\[ERROR\]/);
  assert.match(formatted, /\[SECURITY\]/);
  assert.match(formatted, /facing=external/);
  assert.match(formatted, /Table public\.foo has RLS disabled/);
  assert.match(formatted, /Remediation: https:\/\/supabase\.com/);
});

test("formatLint: tolerates lints missing optional fields", () => {
  const formatted = formatLint({ name: "x", level: "WARN" }, "performance");
  assert.match(formatted, /\[performance\]\[WARN\]/);
  // Should not crash or include placeholder noise.
  assert.doesNotMatch(formatted, /undefined/);
});

// ─── runAdvisorsCheck (integration glue) ──────────────────────────────────

function mockFetchSequence(...responses) {
  const queue = [...responses];
  return async (url) => {
    const r = queue.shift();
    if (!r) throw new Error(`unexpected fetch: ${url}`);
    return r;
  };
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const noop = () => {};

test("runAdvisorsCheck: fails when env vars are missing", async () => {
  const result = await runAdvisorsCheck({
    env: {},
    fetchImpl: mockFetchSequence(),
    log: noop,
    warn: noop,
    error: noop,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing-prereqs");
});

test("runAdvisorsCheck: passes when both advisors return zero ERROR-level lints", async () => {
  const result = await runAdvisorsCheck({
    env: {
      SUPABASE_ACCESS_TOKEN: "tok",
      SUPABASE_PROJECT_REF: "ref",
    },
    fetchImpl: mockFetchSequence(
      jsonResponse({ lints: [{ name: "x", level: "WARN" }] }),
      jsonResponse({ lints: [{ name: "y", level: "INFO" }] }),
    ),
    log: noop,
    warn: noop,
    error: noop,
  });
  assert.deepEqual(result, { ok: true, errors: 0, warns: 1, infos: 1 });
});

test("runAdvisorsCheck: fails on any ERROR-level lint (security or performance)", async () => {
  const result = await runAdvisorsCheck({
    env: {
      SUPABASE_ACCESS_TOKEN: "tok",
      SUPABASE_PROJECT_REF: "ref",
    },
    fetchImpl: mockFetchSequence(
      jsonResponse({ lints: [] }),
      jsonResponse({
        lints: [
          { name: "unindexed_fk", level: "ERROR", title: "Unindexed FK" },
        ],
      }),
    ),
    log: noop,
    warn: noop,
    error: noop,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "errors-present");
  assert.equal(result.errors, 1);
});

test("runAdvisorsCheck: surfaces API errors as ok=false (no phantom green run)", async () => {
  const result = await runAdvisorsCheck({
    env: {
      SUPABASE_ACCESS_TOKEN: "tok",
      SUPABASE_PROJECT_REF: "ref",
    },
    fetchImpl: mockFetchSequence(jsonResponse({ error: "boom" }, false, 500)),
    log: noop,
    warn: noop,
    error: noop,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "api-error");
});

test("runAdvisorsCheck: sums errors across both endpoints", async () => {
  const result = await runAdvisorsCheck({
    env: {
      SUPABASE_ACCESS_TOKEN: "tok",
      SUPABASE_PROJECT_REF: "ref",
    },
    fetchImpl: mockFetchSequence(
      jsonResponse({
        lints: [
          { name: "rls_disabled", level: "ERROR" },
          { name: "auth_leaked_password_protection", level: "WARN" },
        ],
      }),
      jsonResponse({
        lints: [{ name: "unindexed_fk", level: "ERROR" }],
      }),
    ),
    log: noop,
    warn: noop,
    error: noop,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors, 2);
});
