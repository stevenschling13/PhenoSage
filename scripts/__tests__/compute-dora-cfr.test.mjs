import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeCfr,
  countDeploysFromTags,
  countFailuresFromIssues,
  renderDoraDoc,
} from "../compute-dora-cfr.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── countDeploysFromTags (pure) ──────────────────────────────────────────

test("countDeploysFromTags: counts release-format tags inside the window", () => {
  // Window: 2026-05-01 → 2026-05-22.
  const since = Date.UTC(2026, 4, 1, 12);
  const until = Date.UTC(2026, 4, 22, 12);
  const tags = [
    "v2026.05.16-1",
    "v2026.05.16-2",
    "v2026.05.20-1",
    "v2026.05.21-1",
  ];
  assert.equal(countDeploysFromTags(tags, since, until), 4);
});

test("countDeploysFromTags: skips tags outside the window", () => {
  // Window: 2026-05-15 → 2026-05-22.
  const since = Date.UTC(2026, 4, 15, 12);
  const until = Date.UTC(2026, 4, 22, 12);
  const tags = [
    "v2026.04.30-1", // before window
    "v2026.05.16-1", // in window
    "v2026.06.01-1", // after window
  ];
  assert.equal(countDeploysFromTags(tags, since, until), 1);
});

test("countDeploysFromTags: ignores non-release-format tags", () => {
  const since = Date.UTC(2026, 4, 1, 12);
  const until = Date.UTC(2026, 4, 31, 12);
  const tags = [
    "v2026.05.16-1", // counted
    "v1.0.0", // semver — not counted
    "v2026.05.16-rc1", // not a deploy tag
    "latest", // not a tag we recognize
    "v2026.05.16", // missing -N suffix
    "",
    "  ", // whitespace
  ];
  assert.equal(countDeploysFromTags(tags, since, until), 1);
});

test("countDeploysFromTags: empty input returns 0", () => {
  assert.equal(countDeploysFromTags([], 0, Date.now()), 0);
});

// ─── countFailuresFromIssues (pure) ───────────────────────────────────────

const since = Date.UTC(2026, 4, 1);
const until = Date.UTC(2026, 4, 22);

test("countFailuresFromIssues: requires BOTH production AND smoke-test labels", () => {
  const issues = [
    {
      createdAt: "2026-05-10T00:00:00Z",
      labels: [{ name: "production" }, { name: "smoke-test" }],
    },
    {
      createdAt: "2026-05-11T00:00:00Z",
      labels: [{ name: "production" }], // missing smoke-test
    },
    {
      createdAt: "2026-05-12T00:00:00Z",
      labels: [{ name: "smoke-test" }, { name: "bug" }], // missing production
    },
  ];
  assert.equal(countFailuresFromIssues(issues, since, until), 1);
});

test("countFailuresFromIssues: skips issues outside the window", () => {
  const issues = [
    {
      createdAt: "2026-04-30T00:00:00Z",
      labels: ["production", "smoke-test"],
    },
    {
      createdAt: "2026-05-15T00:00:00Z",
      labels: ["production", "smoke-test"],
    },
    {
      createdAt: "2026-06-01T00:00:00Z",
      labels: ["production", "smoke-test"],
    },
  ];
  assert.equal(countFailuresFromIssues(issues, since, until), 1);
});

test("countFailuresFromIssues: handles label as plain string", () => {
  const issues = [
    {
      createdAt: "2026-05-10T00:00:00Z",
      labels: ["production", "smoke-test", "bug"],
    },
  ];
  assert.equal(countFailuresFromIssues(issues, since, until), 1);
});

test("countFailuresFromIssues: accepts created_at (REST API field name)", () => {
  const issues = [
    {
      created_at: "2026-05-10T00:00:00Z",
      labels: ["production", "smoke-test"],
    },
  ];
  assert.equal(countFailuresFromIssues(issues, since, until), 1);
});

test("countFailuresFromIssues: defensive against bad inputs", () => {
  assert.equal(countFailuresFromIssues(null, since, until), 0);
  assert.equal(countFailuresFromIssues(undefined, since, until), 0);
  assert.equal(
    countFailuresFromIssues(
      [null, "garbage", { labels: ["production", "smoke-test"] }],
      since,
      until,
    ),
    0, // last issue has no createdAt
  );
});

// ─── computeCfr (pure) ────────────────────────────────────────────────────

test("computeCfr: zero deploys returns null (caller renders n/a)", () => {
  assert.equal(computeCfr(0, 0), null);
  assert.equal(computeCfr(0, 5), null);
});

test("computeCfr: simple ratio", () => {
  assert.equal(computeCfr(10, 1), 0.1);
  assert.equal(computeCfr(20, 0), 0);
});

test("computeCfr: clamped to 1.0 when failures exceeds deploys", () => {
  // Multiple failures of the same deploy can produce this in practice.
  assert.equal(computeCfr(2, 5), 1);
});

// ─── renderDoraDoc ────────────────────────────────────────────────────────

test("renderDoraDoc: includes deploys, failures, CFR percentage, and fenced JSON block", () => {
  const doc = renderDoraDoc({
    deploys: 14,
    failures: 2,
    cfr: 2 / 14,
    windowDays: 30,
    generatedAt: "2026-05-22T00:00:00.000Z",
  });
  assert.match(doc, /Production deploys:\*\* 14/);
  assert.match(doc, /Failed deploys:\*\* 2/);
  assert.match(doc, /Change Failure Rate:\*\* 14\.29%/);
  assert.match(doc, /```json\n[\s\S]*"changeFailureRate":/);
  assert.match(doc, /"version": 1/);
});

test("renderDoraDoc: shows n/a when CFR is null (zero deploys)", () => {
  const doc = renderDoraDoc({
    deploys: 0,
    failures: 0,
    cfr: null,
    windowDays: 30,
    generatedAt: "2026-05-22T00:00:00.000Z",
  });
  assert.match(doc, /Change Failure Rate:\*\* n\/a/);
  assert.match(doc, /"changeFailureRate": null/);
});

// ─── Integration: full pipeline glue ─────────────────────────────────────

test("end-to-end: real-looking inputs produce the expected CFR", () => {
  const now = Date.UTC(2026, 4, 22, 12);
  const sinceMs = now - 30 * DAY_MS;
  const tags = [
    "v2026.04.20-1", // out (before window)
    "v2026.04.25-1", // in
    "v2026.05.01-1", // in
    "v2026.05.10-1", // in
    "v2026.05.10-2", // in (same day, second deploy)
    "v2026.05.15-1", // in
    "v2026.05.22-1", // in (boundary, noon UTC same day)
    "v2026.06.05-1", // out (future)
  ];
  const deploys = countDeploysFromTags(tags, sinceMs, now);
  // 4-25, 5-01, 5-10, 5-10, 5-15, 5-22 → 6
  assert.equal(deploys, 6);

  const issues = [
    {
      createdAt: "2026-05-10T13:00:00Z",
      labels: ["production", "smoke-test"],
    },
    {
      createdAt: "2026-04-15T00:00:00Z", // out
      labels: ["production", "smoke-test"],
    },
    {
      createdAt: "2026-05-22T00:00:00Z",
      labels: [{ name: "production" }, { name: "smoke-test" }],
    },
  ];
  const failures = countFailuresFromIssues(issues, sinceMs, now);
  assert.equal(failures, 2);

  const cfr = computeCfr(deploys, failures);
  assert.equal(cfr, 2 / 6);
});
