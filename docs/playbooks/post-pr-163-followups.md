# Post PR #163 — Continuation Handoff

Last updated: 2026-05-15 · Author: Claude (handoff for any AI/human agent)

This is a self-contained continuation doc. If you are an AI agent picking up
this work mid-stream because the previous session ran out of context, **read
this top-to-bottom before doing anything else**. Everything you need to
resume is here: PR history, code locations, exact commands, the priority
queue, and the safety rails.

> **Source PR for this doc**: stevenschling13/PhenoSage#163
> (`perf(chat): pg_trgm search + per-tool rate limits + file-budget guard`,
> merged 2026-05-15 as commit `a2aa549`).
> Original review report and 7-step plan lived in the chat session that
> spawned that PR.

---

## 0. Quick-start (1-minute orientation)

```bash
cd /home/user/PhenoSage          # or wherever the repo lives
git fetch origin main
git checkout -b claude/<your-slice-name> origin/main

# Sanity checks before you touch anything:
pnpm install --frozen-lockfile
pnpm run validate                # env, routes, imports, code-scanning, budgets
pnpm turbo run type-check
pnpm turbo run test              # 676+ tests, ~14s
pnpm turbo run lint
cd apps/analysis && python3 -m pytest -q   # 86 tests, <1s
```

If all six commands above are green, your environment is healthy and you
can pick any item off the priority queue in §4. If any are red, **fix the
environment first** — do not start feature work on a broken baseline.

---

## 1. What PR #163 shipped (so you don't redo it)

| Area       | Change                                                                                                                                                           | File(s)                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Migration  | `pg_trgm` in `extensions` schema + GIN trigram indexes on grows/plants hot columns + `search_grows` / `search_plants` SECURITY INVOKER RPCs ranked by similarity | `supabase/migrations/019_pg_trgm_search.sql`                                   |
| Chat tools | `find_grow` / `find_plant` switched to RPCs with ILIKE fallback                                                                                                  | `apps/web/src/lib/server/chat-tools.ts` (find_grow / find_plant case branches) |
| Chat tools | `trigger_plant_analysis` wrapped in 45s `Promise.race` w/ `clearTimeout` in `.finally()`                                                                         | same file, `trigger_plant_analysis` case                                       |
| Chat tools | Per-tool rate limits extracted                                                                                                                                   | `apps/web/src/lib/server/chat-tool-policies.ts`                                |
| Chat tools | Tool definitions extracted as pure data                                                                                                                          | `apps/web/src/lib/server/chat-tool-definitions.ts`                             |
| Web form   | `plant-form.tsx` now uses `useActionWithRecovery`                                                                                                                | `apps/web/src/app/(app)/plants/new/plant-form.tsx`                             |
| Constants  | `MAX_DESCRIPTION_LENGTH` / `MAX_FUTURE_START_MS` deduped                                                                                                         | `apps/web/src/app/(app)/grows/constants.ts`                                    |
| CI         | Per-file line-count budget guard                                                                                                                                 | `scripts/check-file-budgets.mjs`                                               |

**Action required (not yet done):** apply migration 019 to **production** via
`supabase db push`. The Supabase Preview check on PR #163 confirmed the
migration is syntactically valid against a real Postgres, but until it's
applied to prod, `find_grow` / `find_plant` use the ILIKE fallback path.

---

## 2. Repo + branch hygiene

- **Default branch**: `main`. Never push directly.
- **Branch naming for AI sessions**: `claude/<short-kebab-name>`.
- **Commit format**: Conventional Commits — `type(scope): subject`. Husky
  - commitlint will reject anything else. Valid types: `feat`, `fix`,
    `perf`, `refactor`, `docs`, `chore`, `test`, `build`, `ci`, `style`.
    Combined forms like `perf+refactor` are rejected — pick one.
- **Pre-commit**: `lint-staged` runs prettier + eslint on staged files
  automatically. Don't bypass with `--no-verify`.
- **PR flow**: open as draft, let CI run, only flip to ready when green.
  Squash-merge to main.

---

## 3. Sensitive paths (touch with care)

From `CLAUDE.md`:

- `supabase/migrations/**` — frozen. **Never edit existing files.** Add a
  new numbered migration (currently next is 020).
- `packages/shared/src/**` — breaks both web + analysis if you touch the
  contracts.
- `apps/web/src/lib/server/**` — server-only modules; must never be
  imported by client code. `check-imports.mjs` enforces this.
- `apps/web/next.config.mjs` — CSP + security headers.
- `apps/web/src/lib/env.ts` + `scripts/check-env-contract.mjs` — env
  contract.
- `apps/analysis/app/routers/**` + `apps/analysis/app/models/**` — FastAPI
  API contract.
- `.github/workflows/**`, `railway.toml`, `apps/web/vercel.json` — deploy.

Run `pnpm run validate` after **any** edit in those paths.

---

## 4. Priority queue (pick from here)

Listed in recommended order. Each item is sized so a single PR + CI cycle
should clear it. **Do one item per PR**; do not bundle.

### P0 — Apply migration 019 to prod (operations, not code)

Use the standard Supabase migration workflow (`supabase db push` after
linking the prod project). Verify:

```sql
select * from extensions.pg_extension where extname = 'pg_trgm';
select indexname from pg_indexes
 where schemaname = 'public' and indexname like '%_trgm';
select proname from pg_proc where proname in ('search_grows', 'search_plants');
```

Until applied, `find_grow` / `find_plant` log a warn and fall back to
ILIKE — functional, just unranked.

### P1 — Plant-form recovery banner (small, ~30 min)

`apps/web/src/app/(app)/plants/new/plant-form.tsx` adopted the
`useActionWithRecovery` hook in PR #163 but does **not** render the
recovery banner that `grow-form.tsx` renders when `state.recoveryUrl` is
set and navigation didn't take. Copy the pattern from
`apps/web/src/app/(app)/grows/new/grow-form.tsx` (look for
`{state.status === "success" && state.recoveryUrl ?` block) and adapt
the copy for the plant create flow. Single-plant lands on the new plant
detail page; bulk lands back on `/grows` — both targets are already in
`state.redirectTo` so the banner just renders a `<Link>` to it.

Tests: add a Vitest case to `apps/web/src/app/(app)/plants/__tests__/`
that mocks an action result of `{ status: "success", recoveryUrl: "/grows" }`
and asserts the banner renders.

### P2 — CodeQL severity gate (small, ~45 min)

Today CodeQL surfaces alerts as advisories — PR #146 fixed a real SSRF
that had been sitting open. Wire CodeQL into required checks so severity
≥ High blocks merge.

- Edit `.github/workflows/codeql.yml` (or equivalent) to fail on High +
  Critical alerts.
- Update branch protection on `main` to require the CodeQL check.
- Document in `docs/runbooks/codeql-triage.md` how to investigate /
  exempt a finding.

### P3 — Auto-open follow-up issues from PR bodies (medium, ~2 h)

PRs #142–#145 all flagged deferred work in prose. Without structured
tracking, follow-ups rot. Build a GitHub Actions workflow that:

1. Triggers on `pull_request: closed` where `merged == true`.
2. Parses the PR body for a `## Follow-ups` section.
3. For each bullet in that section, opens a new issue labeled
   `from:pr-<N>` and `area:<inferred-from-paths>`.

Add `## Follow-ups` to `.github/PULL_REQUEST_TEMPLATE.md` if a template
exists, or create one.

### P4 — Migration parity check (small–medium, ~1 h)

`scripts/check-migration-parity.mjs` that uses the Supabase MCP (or
`supabase db diff`) to confirm the prod schema matches the migration
folder. Add to a nightly workflow, not to `pnpm run validate` (it needs
network + credentials).

### P5 — Async `trigger_plant_analysis` via `analysis_jobs` (large, multi-PR)

**Do NOT attempt this in one PR.** Sequence:

1. Build a worker (likely a `apps/web/src/app/api/internal/jobs/run/route.ts`
   route called by a Railway cron or Supabase cron). It SELECTs queued
   jobs, sets `status='running'`, calls
   `runAndPersistPlantAnalysis()`, marks `succeeded` / `failed`,
   handles retries via `next_attempt_at`.
2. Add a `get_analysis_job_status(jobId)` chat tool so the model can
   poll.
3. Add an `analysis-status` realtime channel so the client sees state
   transitions without polling.
4. Flip `trigger_plant_analysis` to enqueue via `enqueue_analysis_job`
   (service-role-only RPC already exists in migration 005) and return
   `{ jobId, status: "queued" }` immediately.
5. Update the system prompt in `chat-prompt.ts` so the model knows the
   tool now returns "started" not "result".
6. Delete `ANALYSIS_TOOL_TIMEOUT_MS` from `chat-tools.ts`.

### P6 — `plant_aliases` table for chat (medium, ~3 h)

PR #143 follow-up. New migration 02X:

```sql
create table plant_aliases (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references plants(id) on delete cascade,
  alias text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (plant_id, lower(alias))
);
-- RLS: same shape as plants — grow members read; only owner writes.
```

Then `search_plants` extends the union to include aliases. Add a chat
tool `add_plant_alias(plantId, alias)` for the bot to learn nicknames.

### P7 — Action receipt UI cards (large, UI-heavy)

PR #144 follow-up. When the chat write tools (`create_grow`,
`update_plant`, etc.) emit results, render them as audit cards in the
chat thread. Requires:

- Server change: include a `receipt` field in `ToolResult` from write
  tools with a stable shape (`{ kind: "create_grow", id, name, … }`).
- Client change: render-by-kind component in the chat message list.

Do not start until #P1–#P5 are done; it's the highest-context item and
benefits most from a stable backend.

---

## 5. Verification matrix

| Check                  | Command                                    | Pass criterion                      |
| ---------------------- | ------------------------------------------ | ----------------------------------- |
| Env contract           | `pnpm run check:env`                       | exit 0                              |
| Route boundaries       | `pnpm run check:routes`                    | exit 0                              |
| Imports                | `pnpm run check:imports`                   | exit 0                              |
| Code scanning patterns | `pnpm run check:code-scanning`             | exit 0                              |
| **File-size budgets**  | `pnpm run check:budgets`                   | exit 0 — split files before raising |
| Type-check             | `pnpm turbo run type-check`                | 2/2 packages green                  |
| Web tests              | `pnpm turbo run test`                      | 676+ tests green                    |
| Web lint               | `pnpm turbo run lint`                      | no errors                           |
| Route security         | `pnpm run security:routes`                 | 14+ route files clean               |
| Analysis tests         | `cd apps/analysis && python3 -m pytest -q` | 86+ green                           |

The aggregate `pnpm run validate` runs env + routes + imports +
code-scanning + budgets. **Always run it after any sensitive-path edit.**

---

## 6. CI checks on PRs (what must be green)

From PR #163's clean run, these are the checks that gate merge:

- `Web — Lint, Type, Test, Build`
- `Shared — Type & Test`
- `Analysis — Lint, Type, Test, Audit`
- `Repo — Guardrails`
- `CodeQL` (`Analyze (javascript-typescript)`, `Analyze (python)`,
  `Analyze (actions)`)
- `Secret scan`
- `GitGuardian Security Checks`
- `Gate — Trust + Secrets`
- `Supabase Preview` (runs new migrations against a preview Postgres)
- `Vercel` (preview deployment)
- `CI — All green` (aggregator)

If any non-skipped check is red, **investigate before pushing more**.
Re-pushing on a red CI multiplies the noise without fixing the root
cause.

---

## 7. Useful pointers

- Project instructions: `CLAUDE.md` (non-negotiables), `AGENTS.md`
  (universal agent rules), `.github/copilot-instructions.md`.
- Architecture, ops, deploy: `docs/supabase-guide.md`,
  `docs/deployment.md`, `docs/runbooks/`.
- Last-session continuity: `WORKLOG.md` (append a brief entry per
  session — keep it terse, this doc carries the structured plan).
- Skills (slash commands): see the list returned by Claude Code at
  session start. `phenosage-morning-ops`, `phenosage-ship-check`,
  `phenosage-supabase-ops` are the most useful.

---

## 8. Anti-patterns to avoid

- **Bundling unrelated changes** into one PR. Each priority-queue item
  is its own PR.
- **Editing existing migrations.** Always add a new numbered file.
- **Bumping a file-size budget** instead of splitting. The whole point
  of the guard is to force a refactor — if you find yourself wanting
  to raise the limit, extract code first.
- **Skipping commitlint or husky** with `--no-verify`.
- **Pushing to `main` directly.** Always go through a PR + CI.
- **Adding `middleware.ts` to `apps/web`.** The boundary lives in Route
  Handlers (see `CLAUDE.md`).
- **Letting deferred work live only in PR bodies.** When in doubt, open
  an issue. The auto-issue workflow in P3 will eventually formalise
  this.
