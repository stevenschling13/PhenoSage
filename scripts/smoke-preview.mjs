#!/usr/bin/env node
// scripts/smoke-preview.mjs
//
// Post-deploy smoke check for the Vercel-hosted web app.
//
// Catches the kind of regressions that pre-merge CI can't see because they
// only manifest against a real deployment — wrong env vars, missing build
// SHA, broken auth wiring, broken error envelopes, accidentally returning
// HTML 500 pages from API routes, leaking secrets in error bodies, etc.
//
// Usage:
//   PHENOSAGE_BASE_URL=https://your-preview.vercel.app pnpm run smoke:preview
//
// Exits non-zero on any failure so it can gate a deploy promotion.

const BASE_URL = process.env.PHENOSAGE_BASE_URL || process.env.SMOKE_BASE_URL;

if (!BASE_URL) {
  console.error(
    "✗ smoke-preview: PHENOSAGE_BASE_URL is required (e.g. https://your-preview.vercel.app)",
  );
  process.exit(2);
}

const base = BASE_URL.replace(/\/$/, "");

// Substrings that must NEVER appear in any API response body. Any of these
// in a public response is a security incident.
const FORBIDDEN_SUBSTRINGS = [
  "fetch failed",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "ANALYSIS_SERVICE_API_KEY",
  // Signed Supabase storage URL pattern.
  "/object/sign/",
  // Stack-trace fragment ("at fn (file.js:123)").
  // We match the leading "    at " indent + identifier to avoid false
  // positives on prose like "look at the docs".
];
const STACK_TRACE_RE = /^\s+at\s+\S+\s*\(/m;

const failures = [];

function fail(check, detail) {
  failures.push({ check, detail });
  console.error(`  ✗ ${check}: ${detail}`);
}

function pass(check) {
  console.log(`  ✓ ${check}`);
}

async function probe(path, init = {}) {
  const url = `${base}${path}`;
  const res = await fetch(url, init);
  const text = await res.text();
  return { res, text, url };
}

function assertSafeBody(check, text) {
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (text.includes(needle)) {
      fail(check, `response contains forbidden substring "${needle}"`);
      return false;
    }
  }
  if (STACK_TRACE_RE.test(text)) {
    fail(check, "response contains a stack-trace fragment ('    at …')");
    return false;
  }
  return true;
}

async function checkHealthz() {
  const check = "GET /api/healthz returns 200 JSON";
  const { res, text } = await probe("/api/healthz");
  if (res.status !== 200) {
    return fail(check, `expected 200, got ${res.status}`);
  }
  if (!(res.headers.get("content-type") || "").includes("application/json")) {
    return fail(
      check,
      `expected application/json, got ${res.headers.get("content-type")}`,
    );
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(check, "response is not valid JSON");
  }
  if (body.status !== "ok") {
    return fail(
      check,
      `expected status="ok", got ${JSON.stringify(body.status)}`,
    );
  }
  pass(check);
}

async function checkUnauthChat() {
  const check =
    "POST /api/chat without auth → structured 401 JSON + x-request-id";
  const { res, text } = await probe("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "smoke-test" }),
  });
  if (res.status !== 401) {
    return fail(check, `expected 401, got ${res.status}`);
  }
  if (!res.headers.get("x-request-id")) {
    return fail(check, "x-request-id header missing");
  }
  if (!(res.headers.get("content-type") || "").includes("application/json")) {
    return fail(
      check,
      "API error must be JSON, got " + res.headers.get("content-type"),
    );
  }
  if (!assertSafeBody(check, text)) return;
  pass(check);
}

async function checkUnauthUploadSign() {
  const check =
    "POST /api/uploads/sign without auth → structured 401 JSON + x-request-id";
  const { res, text } = await probe("/api/uploads/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (res.status !== 401) {
    return fail(check, `expected 401, got ${res.status}`);
  }
  if (!res.headers.get("x-request-id")) {
    return fail(check, "x-request-id header missing");
  }
  if (!(res.headers.get("content-type") || "").includes("application/json")) {
    return fail(check, "API error must be JSON");
  }
  if (!assertSafeBody(check, text)) return;
  pass(check);
}

async function checkMalformedJson() {
  const check = "POST /api/chat with malformed JSON → structured 400 JSON";
  const { res, text } = await probe("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  // Either 400 (validated) or 401 (auth-first). Both are acceptable as long
  // as the body is JSON and safe — what we're really proving is that the
  // route doesn't crash with an HTML 500 page on bad input.
  if (![400, 401].includes(res.status)) {
    return fail(check, `expected 400 or 401, got ${res.status}`);
  }
  if (!(res.headers.get("content-type") || "").includes("application/json")) {
    return fail(check, "API error must be JSON");
  }
  if (!assertSafeBody(check, text)) return;
  pass(check);
}

async function main() {
  console.log(`\nsmoke-preview against ${base}\n`);
  await checkHealthz();
  await checkUnauthChat();
  await checkUnauthUploadSign();
  await checkMalformedJson();

  if (failures.length > 0) {
    console.error(`\n✗ smoke-preview: ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log("\n✓ smoke-preview: all checks passed");
}

main().catch((err) => {
  console.error("✗ smoke-preview: unhandled error", err);
  process.exit(1);
});
