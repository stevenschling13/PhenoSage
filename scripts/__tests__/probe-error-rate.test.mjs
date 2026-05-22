import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluate,
  isBreach,
  probeSentry,
  probeVercelLogs,
} from "../probe-error-rate.mjs";

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

// ─── probeVercelLogs ───────────────────────────────────────────────────────

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

test("probeVercelLogs: counts 5xx and total across log entries", async () => {
  const fetchImpl = mockFetch([
    jsonResponse({
      logs: [
        { statusCode: 200 },
        { statusCode: 500 },
        { statusCode: 503 },
        { statusCode: 404 },
        { proxy: { statusCode: 502 } },
        { unrelated: "noise" },
      ],
    }),
  ]);
  const result = await probeVercelLogs({
    token: "tok",
    projectId: "prj",
    teamId: "team",
    deploymentId: "dpl-1",
    windowMin: 5,
    fetchImpl,
  });
  assert.deepEqual(result, { errorCount: 3, totalCount: 5 });
  assert.ok(fetchImpl.calls[0].includes("deploymentId=dpl-1"));
  assert.ok(fetchImpl.calls[0].includes("teamId=team"));
});

test("probeVercelLogs: returns null on non-2xx Vercel response (caller falls back)", async () => {
  const fetchImpl = mockFetch([jsonResponse({}, false)]);
  const result = await probeVercelLogs({
    token: "tok",
    projectId: "prj",
    teamId: undefined,
    deploymentId: "dpl-1",
    windowMin: 5,
    fetchImpl,
  });
  assert.equal(result, null);
});

test("probeVercelLogs: returns null when payload has no logs array", async () => {
  const fetchImpl = mockFetch([jsonResponse({ unexpected: "shape" })]);
  const result = await probeVercelLogs({
    token: "tok",
    projectId: "prj",
    teamId: undefined,
    deploymentId: "dpl-1",
    windowMin: 5,
    fetchImpl,
  });
  assert.equal(result, null);
});

// ─── probeSentry ──────────────────────────────────────────────────────────

test("probeSentry: sums events-stats data points", async () => {
  const fetchImpl = mockFetch([
    jsonResponse({
      data: [
        [1, [3]],
        [2, [4]],
        [3, 5], // also accept scalar value shape
      ],
    }),
  ]);
  const result = await probeSentry({
    authToken: "tok",
    org: "phenosage",
    project: "web",
    release: "v1.2.3",
    windowMin: 5,
    fetchImpl,
  });
  assert.deepEqual(result, { errorCount: 12, totalCount: 12 });
  assert.ok(fetchImpl.calls[0].includes("statsPeriod=5m"));
  assert.ok(fetchImpl.calls[0].includes("release%3Av1.2.3"));
});

test("probeSentry: returns null on Sentry 4xx/5xx", async () => {
  const fetchImpl = mockFetch([jsonResponse({}, false)]);
  const result = await probeSentry({
    authToken: "tok",
    org: "phenosage",
    project: "web",
    release: undefined,
    windowMin: 5,
    fetchImpl,
  });
  assert.equal(result, null);
});

// ─── evaluate (end-to-end glue) ───────────────────────────────────────────

test("evaluate: skips with source=none and ok=true when no secrets configured", async () => {
  const fetchImpl = mockFetch([]);
  const result = await evaluate({ env: {}, fetchImpl });
  assert.equal(result.source, "none");
  assert.equal(result.ok, true);
  assert.match(result.reason, /probe skipped/);
});

test("evaluate: uses Vercel source when token+project+deployment present", async () => {
  const fetchImpl = mockFetch([
    jsonResponse({
      logs: [{ statusCode: 200 }, { statusCode: 200 }],
    }),
  ]);
  const result = await evaluate({
    env: {
      VERCEL_TOKEN: "tok",
      VERCEL_PROJECT_ID: "prj",
      DEPLOYMENT_ID: "dpl-1",
    },
    fetchImpl,
  });
  assert.equal(result.source, "vercel");
  assert.equal(result.ok, true);
  assert.equal(result.errorCount, 0);
  assert.equal(result.totalCount, 2);
});

test("evaluate: falls back to Sentry when Vercel returns null", async () => {
  const fetchImpl = mockFetch([
    jsonResponse({}, false), // Vercel 4xx
    jsonResponse({ data: [[1, [2]]] }), // Sentry
  ]);
  const result = await evaluate({
    env: {
      VERCEL_TOKEN: "tok",
      VERCEL_PROJECT_ID: "prj",
      DEPLOYMENT_ID: "dpl-1",
      SENTRY_AUTH_TOKEN: "stok",
      SENTRY_ORG_SLUG: "phenosage",
      SENTRY_PROJECT_SLUG: "web",
    },
    fetchImpl,
  });
  assert.equal(result.source, "sentry");
});

test("evaluate: reports breach when Vercel ratio above threshold AND floor met", async () => {
  // 50 errors out of 100 = 50%, >> 1% threshold, well above floor of 5.
  const logs = [];
  for (let i = 0; i < 100; i++) {
    logs.push({ statusCode: i < 50 ? 500 : 200 });
  }
  const fetchImpl = mockFetch([jsonResponse({ logs })]);
  const result = await evaluate({
    env: {
      VERCEL_TOKEN: "tok",
      VERCEL_PROJECT_ID: "prj",
      DEPLOYMENT_ID: "dpl-1",
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
  const fetchImpl = mockFetch([jsonResponse({ logs: [{ statusCode: 500 }] })]);
  const result = await evaluate({
    env: {
      VERCEL_TOKEN: "tok",
      VERCEL_PROJECT_ID: "prj",
      DEPLOYMENT_ID: "dpl-1",
    },
    fetchImpl,
  });
  assert.equal(result.source, "vercel");
  assert.equal(result.ok, true);
  assert.match(result.reason, /within budget/);
});

test("evaluate: respects custom thresholds from env", async () => {
  // 4 errors of 10 = 40%, threshold 50% — within budget.
  const fetchImpl = mockFetch([
    jsonResponse({
      logs: Array.from({ length: 10 }, (_, i) => ({
        statusCode: i < 4 ? 500 : 200,
      })),
    }),
  ]);
  const result = await evaluate({
    env: {
      VERCEL_TOKEN: "tok",
      VERCEL_PROJECT_ID: "prj",
      DEPLOYMENT_ID: "dpl-1",
      ERROR_RATE_THRESHOLD: "0.5",
      ERROR_ABSOLUTE_FLOOR: "3",
    },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.thresholdRatio, 0.5);
});
