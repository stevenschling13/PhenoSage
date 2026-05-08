#!/usr/bin/env node
// scripts/check-contract-sync.mjs
//
// Diffs the analysis service's committed OpenAPI export against the
// shared TypeScript types. Fails CI if they drift — either side can
// be the source of truth, but they must move together.
//
// To regenerate the OpenAPI export after a Pydantic change:
//   cd apps/analysis && python3 scripts/export_openapi.py
//
// Then update the matching TS interface / union in
//   packages/shared/src/types.ts
//
// Run via `pnpm run check:contract-sync` (also chained from `validate`).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const OPENAPI = join(ROOT, "apps", "analysis", "openapi.json");
const TYPES = join(ROOT, "packages", "shared", "src", "types.ts");

// Each entry: TS name → matching Python schema name. When the Python
// snake_case differs from camelCase, the field-name comparator handles
// it; this map only handles the *type* name.
const SCHEMA_MAP = {
  // Enums
  FindingCategory: { kind: "enum", python: "FindingCategory" },
  FindingSeverity: { kind: "enum", python: "FindingSeverity" },
  // Interfaces
  AnalysisFinding: { kind: "interface", python: "AnalysisFinding" },
  AnalysisResponse: { kind: "interface", python: "AnalyzeResponse" },
  GrowContext: { kind: "interface", python: "GrowContext" },
};

const errors = [];

function fail(msg) {
  errors.push(msg);
}

// ── Loaders ──────────────────────────────────────────────────────────────

function loadOpenApi() {
  if (!existsSync(OPENAPI)) {
    fail(
      `apps/analysis/openapi.json not found.\n` +
        `  Generate it with: cd apps/analysis && python3 scripts/export_openapi.py`,
    );
    return null;
  }
  return JSON.parse(readFileSync(OPENAPI, "utf8"));
}

const tsSource = readFileSync(TYPES, "utf8");

// ── TS extractors ────────────────────────────────────────────────────────

function extractTsUnion(name) {
  // export type Foo = "a" | "b" | "c";
  const re = new RegExp(`export\\s+type\\s+${name}\\s*=([\\s\\S]*?);`, "m");
  const m = tsSource.match(re);
  if (!m) return null;
  const literals = [...m[1].matchAll(/"([^"]+)"/g)].map((mm) => mm[1]);
  return literals.length ? literals : null;
}

function extractTsInterface(name) {
  // export interface Foo { ... }
  // Captures the body up to the matching closing brace at column 0.
  const re = new RegExp(
    `export\\s+interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`,
    "m",
  );
  const m = tsSource.match(re);
  if (!m) return null;
  const body = m[1];
  const fields = {};
  // Each field is on its own line: `  fieldName?: type;` (or with comments).
  const fieldRe = /^\s*(?!\/\/)([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\s*:\s*[^;]+;/gm;
  let mm;
  while ((mm = fieldRe.exec(body)) !== null) {
    fields[mm[1]] = { optional: Boolean(mm[2]) };
  }
  return fields;
}

// ── OpenAPI extractors ───────────────────────────────────────────────────

function extractOpenApiEnum(schemas, name) {
  const sc = schemas[name];
  if (!sc) return null;
  if (!Array.isArray(sc.enum)) return null;
  return sc.enum;
}

function extractOpenApiInterface(schemas, name) {
  const sc = schemas[name];
  if (!sc) return null;
  if (!sc.properties) return null;
  const required = new Set(sc.required ?? []);
  const fields = {};
  for (const [prop, _spec] of Object.entries(sc.properties)) {
    fields[prop] = { optional: !required.has(prop) };
  }
  return fields;
}

// ── Comparators ──────────────────────────────────────────────────────────

function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function compareEnum(name, py, ts) {
  const pyS = [...py].sort();
  const tsS = [...ts].sort();
  if (pyS.length !== tsS.length || pyS.some((v, i) => v !== tsS[i])) {
    fail(
      `Enum mismatch for ${name}:\n` +
        `  python (${pyS.length}): ${pyS.join(", ")}\n` +
        `  ts     (${tsS.length}): ${tsS.join(", ")}`,
    );
  }
}

function compareInterface(tsName, pyName, py, ts) {
  // Python uses snake_case; TS uses camelCase. Normalize Python to
  // expected camelCase, then diff.
  const pyExpected = {};
  for (const [k, v] of Object.entries(py)) {
    pyExpected[snakeToCamel(k)] = v;
  }

  const pyKeys = new Set(Object.keys(pyExpected));
  const tsKeys = new Set(Object.keys(ts));

  const missingInTs = [...pyKeys].filter((k) => !tsKeys.has(k));
  const missingInPy = [...tsKeys].filter((k) => !pyKeys.has(k));

  if (missingInTs.length) {
    fail(
      `${tsName} (TS) is missing fields present in ${pyName} (Python): ${missingInTs.join(", ")}`,
    );
  }
  if (missingInPy.length) {
    fail(
      `${pyName} (Python) is missing fields present in ${tsName} (TS): ${missingInPy.join(", ")}`,
    );
  }

  for (const key of pyKeys) {
    if (!tsKeys.has(key)) continue;
    const a = pyExpected[key].optional;
    const b = ts[key].optional;
    if (a !== b) {
      fail(
        `Required-ness mismatch on ${tsName}.${key}: ` +
          `python optional=${a}, ts optional=${b}`,
      );
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

const openapi = loadOpenApi();
if (openapi) {
  const schemas = openapi.components?.schemas ?? {};

  for (const [tsName, spec] of Object.entries(SCHEMA_MAP)) {
    if (spec.kind === "enum") {
      const py = extractOpenApiEnum(schemas, spec.python);
      const ts = extractTsUnion(tsName);
      if (!py) {
        fail(`OpenAPI is missing enum ${spec.python}`);
        continue;
      }
      if (!ts) {
        fail(`types.ts is missing union type ${tsName}`);
        continue;
      }
      compareEnum(tsName, py, ts);
      continue;
    }

    if (spec.kind === "interface") {
      const py = extractOpenApiInterface(schemas, spec.python);
      const ts = extractTsInterface(tsName);
      if (!py) {
        fail(`OpenAPI is missing object schema ${spec.python}`);
        continue;
      }
      if (!ts) {
        fail(`types.ts is missing interface ${tsName}`);
        continue;
      }
      compareInterface(tsName, spec.python, py, ts);
    }
  }
}

if (errors.length) {
  console.error("✗ check-contract-sync: violations\n");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nFix:\n" +
      "  1. If you changed Pydantic models, regenerate openapi.json:\n" +
      "       cd apps/analysis && python3 scripts/export_openapi.py\n" +
      "  2. Update the matching TS type in packages/shared/src/types.ts\n" +
      "  3. Re-run pnpm run check:contract-sync\n",
  );
  process.exit(1);
}

console.log(
  `✓ check-contract-sync: OK (${Object.keys(SCHEMA_MAP).length} contracts checked)`,
);
