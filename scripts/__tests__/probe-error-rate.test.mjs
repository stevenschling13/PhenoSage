import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluate, isBreach, probeVercelEvents } from "../probe-error-rate.mjs";

// ─── isBreach (pure) ───────────────────────────────────────────────────────

test("isBreach: no breach when totalCount is zero", () => {
  assert.equal(
    isBreach({
      errorCount: 0,
      totalCount: 0,
      thresholdRatio: 0.01,
      absoluteFloor: 5,
    }),
    false,
  );
});

test("isBreach: low-traffic spike below absolute floor is NOT a breach", () => {
  // 2-of-3 = 66.7% but only 2 absolute errors — should not flip.
  assert.equal(
    isBreach({
      errorCount: 2,
      totalCount: 3,
      thresholdRatio: 0.01,
      absoluteFloor: 5,
    }),
    false,
  );
});

test("isBreach: ratio above threshold AND floor met IS a breach", () => {
  assert.equal(
    isBreach({
      errorCount: 10,
      totalCount: 500,
      thresholdRatio: 0.01,
      absoluteFloor: 5,
    }),
    true,
  );
});

test("isBreach: floor met but ratio below threshold is NOT a breach", () => {
  // 5 errors out of 100,000 = 0.005% — well below 1% threshold.
  assert.equal(
    isBreach({
      errorCount: 5,
      totalCount: 100_000,
      thresholdRatio: 0.01,
      absoluteFloor: 5,
    }),
    false,
  );
});

// ─── probeVercelEvents ───────────────────────────────────────────────────

function mockFetch(responses) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch call");
    return next;
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

// Real Vercel v3 events response is an ARRAY of events, where invocation
// events carry HTTP status under `payload.statusCode` (verified against
// Vercel REST API schema 2026-05-22).
function invocation(statusCode) {
  return {
    type: "edge-function-invocation",
    payload: { statusCode, proxy: { host: "x.vercel.app" } },
  };
}

test("probeVercelEvents: hits /v3/deployments/{id}/events with limit=-1", async () => {
  const fetchImpl = mockFetch([
    jsonResponse([invocation(200), invocation(200), invocation(500)]),
  ]);
  const result = await probeVercelEvents({
    token: "tok",
    teamId: "team_xyz",
    deploymentId: "dpl_abc",
    windowMin: 5,
    fetchImpl,
  });
  assert.deepEqual(result, { errorCount: 1, totalCount: 3 });
  const url = fetchImpl.calls[0];
  assert.ok(url.includes("/v3/deployments/dpl_abc/events"));
  assert.ok(url.includes("limit=-1"));
  assert.ok(url.includes("teamId=team_xyz"));
  assert.ok(url.includes("since="));
});

test("probeVercelEvents: classifies 5xx range correctly", async () => {
  const fetchImpl = mockFetch([
    jsonResponse([
      invocation(200),
      invocation(499),
      invocation(500),
      invocation(503),
      invocation(599),
      invocation(600), // outside HTTP range — ignored as a status entry
    ]),
  ]);
  const result = await probeVercelEvents({
    token: "tok",
    teamId: undefined,
    deploymentId: "dpl_abc",
    windowMin: 5,
    fetchImpl,
  });
  // 200, 499, 500, 503, 599, 600 → 6 total, but 600 isn't 5xx
  // and IS counted in totalCount as a status was present.
  // The script counts every entry with a statusCode as part of total.
  assert.equal(result.totalCount, 6);
  assert.equal(result.errorCount, 3); // 500, 503, 599
});

test("probeVercelEvents: ignores build/stdout events that have no statusCode", async () => {
  const fetchImpl = mockFetch([
    jsonResponse([
      { type: "stdout", payload: { text: "build output" } },
      { type: "deployment-state", payload: { readyState: "READY" } },
      invocation(200),
      invocation(500),
    ]),
  ]);
  const result = await probeVercelEvents({
    token: "tok",
    teamId: undefined,
    deploymentId: "dpl_abc",
    windowMin: 5,
    fetchImpl,
  });
  assert.deepEqual(result, { errorCount: 1, totalCount: 2 });
});

test("probeVercelEvents: returns null on non-2xx Vercel response", async () => {
  const fetchImpl = mockFetch([jsonResponse([], false)]);
  const result = await probeVercelEvents({
    token: "tok",
    teamId: undefined,
    deploymentId: "dpl_abc",
    windowMin: 5,
    fetchImpl,
  });
  assert.equal(result, null);
});

test("probeVercelEvents: returns null when payload is not an array", async () => {
  const fetchImpl = mockFetch([jsonResponse({ unexpected: "shape" })]);
  const result = await probeVercelEvents({
    token: "tok",
    teamId: undefined,
    deploymentId: "dpl_abc",
    windowMin: 5,
    fetchImpl,
  });
  assert.equal(result, null);
});

test("probeVercelEvents: tolerates legacy top-level statusCode field", async () => {
  // Defensive — old/streaming endpoints surface statusCode at the
  // event root rather than payload.statusCode.
  const fetchImpl = mockFetch([
    jsonResponse([{ type: "metric", statusCode: 200 }, { statusCode: 500 }]),
  ]);
  const result = await probeVercelEvents({
    token: "tok",
    teamId: undefined,
    deploymentId: "dpl_abc",
    windowMin: 5,
    fetchImpl,
  });
  assert.deepEqual(result, { errorCount: 1, totalCount: 2 });
});

// ─── evaluate (end-to-end glue) ───────────────────────────────────────────

test("evaluate: skips with source=none when no VERCEL_TOKEN", async () => {
  const fetchImpl = mockFetch([]);
  const result = await evaluate({ env: {}, fetchImpl });
  assert.equal(result.source, "none");
  assert.equal(result.ok, true);
  assert.match(result.reason, /VERCEL_TOKEN not configured/);
});

test("evaluate: skips with source=none when VERCEL_DEPLOYMENT_UID not resolved", async () => {
  const fetchImpl = mockFetch([]);
  const result = await evaluate({
    env: { VERCEL_TOKEN: "tok" },
    fetchImpl,
  });
  assert.equal(result.source, "none");
  assert.equal(result.ok, true);
  assert.match(result.reason, /VERCEL_DEPLOYMENT_UID not resolved/);
});

test("evaluate: reports breach when ratio above threshold AND floor met", async () => {
  // 50 errors out of 100 = 50%, >> 1% threshold, well above floor of 5.
  const events = [];
  for (let i = 0; i < 100; i++) events.push(invocation(i < 50 ? 500 : 200));
  const fetchImpl = mockFetch([jsonResponse(events)]);
  const result = await evaluate({
    env: {
      VERCEL_TOKEN: "tok",
      VERCEL_DEPLOYMENT_UID: "dpl_abc",
    },
    fetchImpl,
  });
  assert.equal(result.source, "vercel");
  assert.equal(result.ok, false);
  assert.equal(result.errorCount, 50);
  assert.equal(result.totalCount, 100);
  assert.match(result.reason, /breach:/);
});

test("evaluate: reports ok when error count is below absolute floor (low-traffic noise)", async () => {
  // 1 of 1 = 100% but only 1 absolute error — floor of 5 saves us.
  const fetchImpl = mockFetch([jsonResponse([invocation(500)])]);
  const result = await evaluate({
    env: {
      VERCEL_TOKEN: "tok",
      VERCEL_DEPLOYMENT_UID: "dpl_abc",
    },
    fetchImpl,
  });
  assert.equal(result.source, "vercel");
  assert.equal(result.ok, true);
  assert.match(result.reason, /within budget/);
});

test("evaluate: respects custom thresholds from env", async () => {
  // 4 errors of 10 = 40%, threshold 50% — within budget.
  const events = [];
  for (let i = 0; i < 10; i++) events.push(invocation(i < 4 ? 500 : 200));
  const fetchImpl = mockFetch([jsonResponse(events)]);
  const result = await evaluate({
    env: {
      VERCEL_TOKEN: "tok",
      VERCEL_DEPLOYMENT_UID: "dpl_abc",
      ERROR_RATE_THRESHOLD: "0.5",
      ERROR_ABSOLUTE_FLOOR: "3",
    },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.thresholdRatio, 0.5);
});

test("evaluate: skips with source=none when Vercel returns null (API failure)", async () => {
  const fetchImpl = mockFetch([jsonResponse({}, false)]);
  const result = await evaluate({
    env: {
      VERCEL_TOKEN: "tok",
      VERCEL_DEPLOYMENT_UID: "dpl_abc",
    },
    fetchImpl,
  });
  assert.equal(result.source, "none");
  assert.equal(result.ok, true);
  assert.match(result.reason, /no usable data/);
});
