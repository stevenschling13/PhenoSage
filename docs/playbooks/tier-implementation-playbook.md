# Tier Implementation Playbook

How an AI or human engineer ships a single Tier 2 / Tier 3 / Tier 4
sub-item end to end. Authored after the Tier 2.1 + 2.2 sweep on PR
`copilot/assess-tier-1-and-plan-tier-2`. The next agent picks up the
next un-checked box in the PR description and follows this document
verbatim.

> Status: **load-bearing**. CI does not enforce this directly, but the
> review bar for any PR touching `apps/web/`, `apps/analysis/`,
> `supabase/migrations/`, or `packages/shared/` is "did the author
> follow this playbook?". Skipping a step requires a one-line note in
> the PR description.

---

## 0. Read-order (≤ 5 minutes)

Before any edits:

1. `CLAUDE.md` — architecture + ports + commands
2. `.github/copilot-instructions.md` — non-negotiable rules
3. `AGENTS.md` — PR caps and forbidden actions
4. `WORKLOG.md` — what the previous session was doing (this is where
   the "next session" hand-off lives)
5. The relevant playbook for the boundary you're touching:
   - Shared type / migration / proxy boundary →
     `docs/playbooks/contract-safe-change-playbook.md`
   - Anything else → this file

---

## 1. Research-first (mandatory, before any code)

Every Tier item that introduces or upgrades an external dependency,
provider, or pattern starts with a documented research pass. The
research artefact lives **in the PR description** under a short
"Research" subsection and in this section's worked example for
sticky context.

What to look up, in this order:

1. **Provider / library current best practices, dated within the last
   12 months.** Use `web_search` (it is acceptable to ask for a "as of
   YYYY-MM" answer to bias toward recency) and at least one
   `web_fetch` against the canonical docs URL or npm registry for the
   package version.
2. **Native idempotency, retry, and rate-limit affordances** of the
   provider. Prefer native over reinventing — Resend ships
   `idempotencyKey`, Supabase ships `.abortSignal()`, OpenAI/Gemini
   SDK ships its own retry. Document which native affordance you're
   using and which gap (if any) you're filling locally.
3. **Latest stable version** via `https://registry.npmjs.org/<pkg>/latest`
   (or PyPI equivalent for `apps/analysis`). Capture the version
   number; this becomes the pinned version in `package.json`.
4. **Security advisories** for that exact version via the
   `gh-advisory-database` tool (npm, pip, go, maven, etc.). If a
   vulnerability is reported, bump to the next non-vulnerable version
   or pick a different library; never ship a known-CVE dep.
5. **Existing repo affordances** that the new code should layer on:
   - `apps/web/src/lib/server/rate-limit.ts` (Upstash + in-memory
     fallback; fail-open semantics)
   - `apps/web/src/lib/server/request-id.ts` (`logServerEvent`,
     `attachRequestId`)
   - `apps/web/src/lib/server/circuit-breaker.ts`
   - `apps/web/src/lib/server/auth.ts` / `db.ts`
   - `packages/shared/src/types.ts` for the contract surface
   - SQLSTATE→friendly copy mapping in
     `apps/web/src/app/(app)/grows/actions.ts:104-160` (the canonical
     pattern; mirror it, don't fork it)

---

## 2. Pick the error-handling tools (mandatory, before any code)

Every Tier item must declare the error-handling stack it'll use **in
the PR description**, before writing code. Default stack:

| Concern                       | Tool                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| Structured server logs        | `logServerEvent('level', 'msg', {...})` from `request-id.ts`  |
| Cross-system correlation      | `x-request-id` via `attachRequestId()` + `logServerEvent`     |
| User-visible error copy       | SQLSTATE map → friendly string (no raw provider text)         |
| Rate-limit / abuse cap        | `rateLimit({key, limit, windowMs})` (Upstash + in-memory)     |
| Per-attempt timeout           | `supabase-js .abortSignal(AbortSignal.timeout(ms))`           |
| Circuit break on hot upstream | `apps/web/src/lib/server/circuit-breaker.ts`                  |
| Idempotency at provider       | Provider-native key (Resend `idempotencyKey`, etc.)           |
| App-side dedupe at write      | Partial UNIQUE index + SELECT-then-INSERT (see migration 016) |
| Crash reporting               | Sentry (`SENTRY_DSN` already wired)                           |
| Web search of unknown errors  | `web_search` against the SDK's GitHub issues + changelog      |

Only add a new error tool / library if the gap can't be closed by the
table above. New deps require step 1.4 (advisory check) first.

---

## 3. Plan in the PR description, not in scratch files

After research, **report_progress** with a checklist that:

- Names every file you intend to touch (path-precise).
- Calls out which files cross a sensitive path (see AGENTS.md
  "sensitive paths"). Sensitive-path edits get explicit subtasks.
- States which validators will gate the change.

Do **not** create scratch markdown files for the plan. The PR
description is the plan; `report_progress` writes there.

---

## 4. Write tests first, then code

Repo convention is Vitest (`apps/web`) and pytest (`apps/analysis`).
Coverage globs are restricted (`apps/web/vitest.config.ts:11-27`):
unit tests live under `src/lib/**/__tests__/` and `src/app/api/**/__tests__/`.
React component behaviour is covered by Playwright (`apps/web/e2e/**`).

For each unit of work:

1. Write the failing test that captures the contract.
2. Implement the smallest change that makes it pass.
3. Add adversarial tests: error paths, empty inputs, race-y conflicts,
   timeout, missing env, malformed provider response.
4. Cover the **happy path + 1 representative failure per externally-
   visible status** (4xx vs 5xx vs network, etc.).

Test mocks must mirror the supabase chain accurately — including
`.abortSignal()` if the production code uses it
(`apps/web/src/app/(app)/grows/__tests__/actions.test.ts:6-10`).

---

## 5. Implement in the smallest possible diff

Hard caps from `AGENTS.md`: ≤ 30 files, ≤ 1,500 lines, ≤ 500 lines
per file. If a tier sub-item bursts the cap, split it. Splitting is
preferred to bundling.

Conventions reminders:

- `import "server-only";` at the top of every `apps/web/src/lib/server/**`
  file.
- `import type { ... } from "@phenosage/shared"` from client
  components (type-only) so the shared runtime never bundles.
- TypeScript is `exactOptionalPropertyTypes: true` — omit optional
  properties rather than assigning `undefined`.
- Migrations are **append-only** (`supabase/migrations/NNN_*.sql`).
  Never edit a committed migration. CHECK constraints cannot
  reference subqueries / system catalog views — use a BEFORE trigger
  raising SQLSTATE `22023` (see migration 017 for the canonical
  example).
- New DB columns must be additive with safe defaults so old rows do
  not need a backfill.
- RLS is mandatory on every public-schema table; document policies
  in the migration header.

---

## 6. Optimization pass

After the implementation lands and tests pass, do **one** dedicated
optimization pass with a paper-trail commit (`perf(scope): …`). The
Tier 2.1 sweep is the worked example: the per-process
`Intl.DateTimeFormat` cache shipped as a separate commit
(`perf(web): cache Intl.DateTimeFormat per zone in timezone helper`)
with two new tests proving cache reuse. Look for:

- Constructor / serialiser / regex compilation in a hot loop → cache
  per process.
- N+1 DB calls → batch with `.in()` or a single join query.
- Per-request env reads → memoise in module scope (still respect
  test-time `process.env` mutation; see `apps/web/src/lib/server/db.ts`).
- Promise serialization that could be `Promise.all`.
- Anything constructed inside a `for` loop that doesn't depend on the
  loop variable.

Skip the optimization pass only if there is genuinely no hot path. Say
so explicitly in the commit message.

---

## 7. Validate, in this exact order

```bash
pnpm run validate                          # env / routes / imports / code-scanning
pnpm --filter web run lint                 # eslint --max-warnings=0
pnpm --filter web run type-check           # tsc --noEmit
pnpm --filter web run test                 # vitest
pnpm run security:routes                   # route-handler security audit
```

If `apps/analysis/**` changed, additionally:

```bash
cd apps/analysis && ruff check . && mypy app/ && pytest --cov=app
```

Stop on first failure. Re-run the full chain after the fix.

---

## 8. CodeQL pass

Always call `codeql_checker` before finalising. Populate
`trivialChangeDeclaration`:

- **trivial**: pure perf, doc, comment, rename, formatting, test-only,
  CSS/UI polish
- **non-trivial**: anything else, including new deps, new env vars,
  new providers, new SQL, new auth/secret paths, new logging that
  could leak PII

Address every alert that's a true positive; document any false
positive in the PR description.

---

## 9. Update WORKLOG.md and the PR description

Two writes, both required, before opening / re-pushing the PR:

1. **WORKLOG.md** (newest entry on top): what landed (with commit
   SHAs), test count delta, and a "Next session" block listing the
   next un-checked Tier item plus any dead-end notes.
2. **PR description checklist**: tick the box you completed; do not
   reorder existing boxes.

The handoff is not done until both writes land.

---

## 10. Worked examples (for muscle memory)

### T2.1 — per-user timezone (shipped)

- Research: `Intl.DateTimeFormat` `en-CA` always emits ISO YYYY-MM-DD
  (verified via web search + Node ICU notes).
- Error tools: SQLSTATE map (22023 from BEFORE trigger), service-role
  bulk-load with UTC-degrade on error, `logServerEvent` everywhere.
- Optimization pass: per-process formatter cache (constructor is
  ~10–100× slower than `.format()`).
- Test count delta: +27.

### T2.2 — Resend transactional email (this PR)

- Research: Resend v6.12.3 (no advisories), native `idempotencyKey`
  (24h, payload-validated), `@react-email/render` is optional → ship
  plain HTML/text. Honor 429 `Retry-After`. Existing repo affordances
  cover rate-limit + structured logs.
- Error tools: lazy SDK init → no-op + warn when key missing (cron
  must not crash); typed Result `{ok:true} | {ok:false, code, ...}`;
  one bounded retry on 429/5xx with `Retry-After` clamp; no retry on
  4xx; `notifications.email_sent_at` for cross-run dedupe; partial
  index for the cron lookup.
- Optimization pass: Resend client memoised at module scope (see
  `email.ts`); template builders are pure (no allocations beyond the
  string concat).

### T3.x / T4.x (your turn)

When you start the next tier item, copy the above shape into the
WORKLOG entry and the PR description. Cite `web_search` results,
`gh-advisory-database` results, and the version pin you chose.

---

## 11. Dead-letter checklist (when you're stuck)

If you can't finish the sub-item in your session:

- Leave the failing test and the half-done code in place. Do not
  revert.
- Mark the un-finished checklist box; do not delete it.
- WORKLOG: write a "Dead end" subsection under the entry naming what
  you tried and why it didn't work, so the next agent doesn't repeat
  the dead end.
- If a contract change is half-applied (shared type updated but
  Pydantic mirror not), call that out in **bold** in WORKLOG; the
  next agent must finish the contract migration before any other
  change.
