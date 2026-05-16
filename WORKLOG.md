# WORKLOG

Handoff log between sessions. Keep entries short. Newest at top.

---

## 2026-05-16 — Supabase MCP full operator read/write feature scope (Codex)

**In-flight on current branch**

- Expanded repo-scoped Supabase MCP URL to explicitly request `read_only=false` and include full operator feature groups for this project: `account,database,debugging,development,docs,functions,branching,storage`.
- Added bearer-token fallback via `SUPABASE_ACCESS_TOKEN` so this runtime can authenticate even when OAuth persistence is unsupported.

**Validation**

- `pnpm run validate` still fails in this Linux runner at `check:smoke-script` with `spawn pwsh ENOENT` (PowerShell unavailable).

---

## 2026-05-16 — MCP bearer-token fallback for Supabase auth (Codex)

**In-flight on current branch**

- Updated `.mcp.json` Supabase server config to include `"bearer_token_env_var": "SUPABASE_ACCESS_TOKEN"` as a fallback when OAuth auth is unsupported in this Codex runtime.
- Validation attempt: `pnpm run validate` reached `check:smoke-script` and failed in this Linux runner with `spawn pwsh ENOENT` (PowerShell missing), so the required validation chain could not complete in-container.

**Dead ends**

- `codex mcp login supabase` OAuth callbacks completed in browser but local Codex MCP status still reports `Auth Unsupported`, so persisted OAuth login is not available in this runtime.

---

## 2026-05-16 — Production smoke harness fix (Copilot)

**Landed on `copilot/investigate-production-smoke-test-failure` at `8b8f940`**

- Hardened `scripts/smoke-test-prod.ps1` so expected protected-route redirects
  are captured as HTTP status codes instead of opaque `ERR` rows.
- Added transport-error handling for root/header and leak-scan probes so a DNS
  or connection failure reports one actionable failure instead of secondary
  null-header errors.
- Added `scripts/__tests__/smoke-test-prod.test.mjs` and wired it into
  `pnpm run validate` via `check:smoke-script`.
- Validation passed after commit: `pnpm run validate`,
  `pnpm turbo run type-check lint test`, `pnpm run security:routes`; CodeQL had
  no analyzable language changes.

---

## 2026-05-15 — Tier 3: active-grow semantic finding retrieval (Copilot)

**In-flight on `copilot/tier-3-roadmap-research`**

- **Landed on branch** `copilot/tier-3-roadmap-research`:
  - `782c213` — added additive migration
    `020_semantic_findings_search.sql`, server-only Gemini/OpenAI-compatible
    finding embeddings, active-grow vector RPC retrieval, and the
    `search_similar_findings` chat tool.
  - `f34c18d` — moved semantic tool execution out of the oversized
    `chat-tools.ts` hot file so `scripts/check-file-budgets.mjs` stays green.
  - `064c012` — hardened semantic retrieval error handling after credible-source
    review: catches embedding client-init failures, logs provider `_request_id`,
    catches Supabase RPC abort/throw paths, and hides raw insert errors from
    chat users.
  - `d8472ae` — kept `chat-tools.ts` under the enforced 1,500-line budget after
    error-hardening.
- **Validation status**: `pnpm install --frozen-lockfile`, `pnpm run validate`,
  `pnpm run validate`, `pnpm turbo run type-check test`,
  `pnpm run security:routes`, `pnpm run security:audit`, and CodeQL all passed.
  Ship-check hard gates passed at `d8472ae`; web tests are now 691/691.
  Advisory `pnpm run format:check` still reports pre-existing formatting drift in
  `apps/web/src/app/globals.css`, `apps/web/src/lib/server/analysis-config.ts`,
  `docs/playbooks/contract-safe-change-playbook.md`, `docs/supabase-guide.md`,
  and `scripts/check-route-boundaries.mjs`.
- **Dead ends / things tried**:
  - Initial baseline validation failed because `pnpm` was not on PATH; fixed by
    enabling pnpm via Corepack (`corepack prepare pnpm@9.0.0 --activate`).
  - First full validation failed because added logic pushed
    `apps/web/src/lib/server/chat-tools.ts` over the 1,500-line budget; fixed
    by extracting semantic execution into `semantic-findings.ts`.
  - Error-hardening briefly pushed `chat-tools.ts` to 1,501 lines; fixed with a
    one-line whitespace reduction and re-ran `pnpm run validate`.
  - `supabase db push --dry-run` and `supabase db lint` could not run locally
    because the Supabase CLI is not installed in this runner.
- **Next bounded follow-up**: apply migration 020 in Supabase, verify
  `match_similar_grow_findings` recall/latency with real `plant_findings`
  embeddings, then decide in a perf-only PR whether to replace/augment the
  existing IVFFlat index with HNSW.

---

## 2026-05-15 — Supabase MCP wiring + agent skills (Copilot)

**In-flight on `copilot/wire-mcp-connection`**

- **Landed on branch** `copilot/wire-mcp-connection` at `609aa6c`:
  installed the checked-in Supabase agent skills under `.agents/skills/**`,
  added Claude symlinks under `.claude/skills/**`, and recorded the install in
  `skills-lock.json`.
- **Ops env/docs**: root `.env.example` now includes `SUPABASE_PROJECT_REF`,
  `SUPABASE_DB_PASSWORD`, and `SUPABASE_DB_URL` placeholders for direct
  Postgres / CLI / MCP-adjacent workflows. `README.md` and `docs/deployment.md`
  now document that `.mcp.json` is already project-scoped to
  `yjemotnclrnlxgcfntaf`, while MCP read/write access comes from the Supabase
  OAuth consent flow rather than committed secrets.
- **Validation**: `pnpm run validate`, `pnpm turbo run type-check lint test`,
  and `pnpm run security:routes` passed after the changes.
- **Dead ends**: the `npx skills add supabase/agent-skills` flow is interactive
  and easy to mis-key in a TTY; selecting both bundled skills required stepping
  through the prompts manually.

---

## 2026-05-15 — Tier 3/4 handoff standard tightened (Copilot)

**Landed on `copilot/review-pr-159-and-plan-tier-2` (commit `57b259e`)**

- Standardised the next-agent process for Tier 3 / Tier 4 so the handoff is
  explicitly research-first: reputable primary sources, recency anchored to at
  least 2026-05-15, optimization opportunities captured before coding, and
  boundary-specific error-handling tools chosen up front.
- Updated the reusable guidance in:
  - `docs/playbooks/tier-implementation-playbook.md`
  - `docs/playbooks/repo-aware-ai-coding-playbook.md`
  - the suggested Tier 3 prompt block in this file
- Validation in this sandbox:
  - `pnpm install --frozen-lockfile`
  - `pnpm run validate`
  - `pnpm turbo run type-check lint test`
  - `pnpm run security:routes`

**In flight**

- Tier 2 sweep PR remains the merge target; use the strengthened prompt / playbook
  language for the first bounded Tier 3 or Tier 4 follow-up after merge.

**Dead ends**

- `pnpm` was not initially on `PATH`; enabled it with Corepack before running the
  validation chain.

## 2026-05-15 — Tier 2 closure briefing + next-agent prompt handoff (Copilot)

**Landed on `copilot/review-pr-159-and-plan-tier-2` (commit `bee041f`)**

Follow-up docs-only closeout so this PR can merge cleanly and the next agent can
start Tier 3 without re-auditing Tier 2.

- **What is complete in this PR's Tier 2 sweep**:
  - **T2.1** per-user timezone support for daily-summary dedupe / delivery
  - **T2.2** Resend-backed email delivery for daily summaries + finding alerts
  - **T2.3** strain-aware analysis context + per-finding confidence
  - **T2.4** pre-vision image-quality gate with explicit inconclusive handling
- **What is _not_ complete**: not every open **Milestone 2 roadmap** item. The
  remaining unchecked roadmap boxes (health trend graph, collaborators, export,
  few-shot prompt refinement, realtime, monitoring) are backlog work and should
  not block merging this Tier 2 sweep PR.
- **Merge recommendation**: merge this branch as the Tier 2 sweep closeout. Do
  not keep this PR open to chase unrelated Milestone 2 backlog.

**Next agent brief (copy/paste shape, then fill in the exact Tier 3 target)**

- **Goal**: start one Tier 3 roadmap item only; keep the PR bounded to one
  concern.
- **Read order**: `CLAUDE.md` → `.github/copilot-instructions.md` →
  `AGENTS.md` → `WORKLOG.md` → relevant playbook.
- **First prompt should specify**:
  1. the exact roadmap item to ship
  2. allowed scope / files if already known
  3. whether contract, migration, or server-route boundaries are expected
  4. required validators
  5. what is explicitly out of scope
- **Recommended starting candidates**:
  - **Milestone 3**: pgvector semantic search, "ask about any past grow"
    memory, automated grow advisor, phenotype tracking, harvest prediction
  - **If staying in Milestone 2 instead**: few-shot prompt refinement or
    Supabase Realtime for live findings updates

**Suggested prompt for the next agent**

> Start a new branch for one Tier 3 roadmap item: **<fill this in>**. First
> read `/home/runner/work/PhenoSage/PhenoSage/CLAUDE.md`,
> `/home/runner/work/PhenoSage/PhenoSage/.github/copilot-instructions.md`,
> `/home/runner/work/PhenoSage/PhenoSage/AGENTS.md`, and
> `/home/runner/work/PhenoSage/PhenoSage/WORKLOG.md`. Then frame the task using
> `/home/runner/work/PhenoSage/PhenoSage/docs/playbooks/repo-aware-ai-coding-playbook.md`
> and `/home/runner/work/PhenoSage/PhenoSage/docs/playbooks/tier-implementation-playbook.md`.
> Operate like a professional software engineer: do a research-first pass using
> reputable primary sources current through at least 2026-05-15, look for best
> practices plus obvious optimization opportunities, and explicitly choose the
> error-handling tools / affordances that fit each boundary you touch before
> writing code. Keep the change to one concern, list the exact files you plan to
> touch, say whether the contract impact is none/additive/breaking, and stop if
> the work would spill beyond a bounded PR. Run `pnpm run validate`, `pnpm turbo run
type-check lint test`, `pnpm run security:routes`, and analysis validators if
> `apps/analysis/**` changes. Update `WORKLOG.md` with what landed, dead ends,
> and the next session block before finishing.

**Performance note for the next agent**

- A better prompt is usually higher leverage than extra implementation context:
  be specific about the target box, boundaries, validators, and out-of-scope
  work. Avoid "finish Tier 3" or "do Milestone 3" prompts; those are too broad
  and tend to burst PR size caps or mix concerns.

---

## 2026-05-15 — Tier 2 merge handoff / wrap-up (Copilot)

**Landed on `copilot/review-pr-159-and-plan-tier-2` (commit `f69003a`)**

Final pass to make the Tier 2 PR merge-ready and give the next agent a clean
Tier 3 handoff.

- **Tier 2 sweep status** — complete on this branch:
  - **T2.1** per-user timezone for daily summary / notification dedupe
  - **T2.2** Resend-backed email delivery for `daily_summary` and
    `finding_alert`
  - **T2.3** strain-aware analysis context + per-finding confidence scores
  - **T2.4** pre-vision image-quality gate
- **T2.4 last-mile hardening** — Pillow `DecompressionBombError` now maps to
  stable reason `image_too_large`, and the fallback log includes
  `image_quality_reason` for ops triage instead of collapsing to an untyped
  500 / generic fallback.
- **Validation** — all green in this sandbox after bootstrapping the toolchain:
  - `pnpm install --frozen-lockfile`
  - `pnpm run validate`
  - `pnpm turbo run type-check lint test`
  - `pnpm run security:routes`
  - `cd apps/analysis && ruff check . && mypy app/ && pytest --cov=app`
- **Merge assessment** — no further Tier 2 optimization is merge-blocking.
  Any future tuning should be field-data follow-up work (for example image
  quality thresholds), not more scope in this PR.

**Dead end / env note**

- `pnpm run build` remains blocked in this sandbox by `next/font` reaching
  `fonts.googleapis.com` for Fraunces / JetBrains Mono. This is an environment
  network limitation, not a known code regression on the branch.

**Next session**:

- Treat this PR as the end of the Tier 2 sweep and start a fresh Tier 3 branch.
- Tier 3 roadmap entry points: pgvector semantic search, "ask about any past
  grow" memory, automated grow advisor, phenotype tracking, harvest prediction.
- Milestone 2 still has unrelated roadmap items open (for example health trend
  graph, collaborators, export history, few-shot prompt refinement, realtime,
  monitoring), but they are outside this Tier 2 PR handoff.

---

## 2026-05-15 — Tier 2.3: strain-aware prompt + per-finding confidence (Copilot)

**Landed on `copilot/review-pr-159-and-plan-tier-2` (commit `b86dd76`)**

Closes the last remaining item from the Tier 2 sweep: the analysis service now
requests a confidence score per finding, treats cultivar / strain as a weak
prior instead of proof, persists confidence on `plant_findings`, and surfaces
it in the plant detail findings rail.

- **Migration `20260515175712_analysis_finding_confidence.sql`** — additive
  nullable `plant_findings.confidence_score numeric(3,2)` plus a `0..1`
  range check.
- **Shared contract** — `packages/shared/src/types.ts` adds additive optional
  `confidenceScore` on both `AnalysisFinding` and `PlantFinding`.
- **FastAPI mirror** — `apps/analysis/app/models/analysis.py` adds
  `confidence_score`; `prompts.py` documents the new JSON field and makes the
  strain/cultivar guidance explicit: use cultivar context as a weak prior only,
  never over visible evidence in the image.
- **Analysis defaults** — synthetic fallback / incomplete findings now carry
  explicit low confidence scores (`0.0` and `0.15`) so the UI can surface that
  they are non-diagnostic / low-confidence states.
- **Web proxy + persistence** — nested analysis-service
  `confidence_score` is normalized to `confidenceScore`, persisted through
  `apps/web/src/lib/server/plants.ts`, and rendered as a percentage in the
  plant detail findings rail.
- **Tests** — focused passes:
  - `apps/analysis`: `ruff check . && mypy app/ && pytest tests/test_prompts.py tests/test_image_analysis.py tests/test_analyze_router.py` → **45/45**
  - `packages/shared`: `pnpm test && pnpm type-check` → **7/7**
  - `apps/web`: `pnpm test -- --run src/lib/server/__tests__/analysis-proxy.test.ts src/lib/server/__tests__/plants.test.ts && pnpm type-check && pnpm lint` → **33/33**

**Dead end / env note**

- `pnpm run build` in this sandbox still fails at `next/font` because the
  build cannot reach `fonts.googleapis.com` for Fraunces / JetBrains Mono.
  This is an environment/network limitation, not a code regression; CI/Vercel
  has previously built this path successfully.

**Next session**:

- Tier 2 sweep is complete. Next likely milestone items are
  **refined prompts with few-shot examples**, **live findings updates via
  Supabase Realtime**, or other remaining Milestone 2 roadmap items.

## 2026-05-15 — Tier 2.4: pre-vision image-quality gate in apps/analysis (Copilot)

**Landed on `copilot/review-pr-159-and-plan-tier-2` (commit `f69003a`)**

Picks up T2.4 from the Tier Implementation Playbook hand-off in PR #161.
Adds an explicit _inconclusive_ path for unanalysable images so the
vision model is never asked to diagnose blank/blurry/blown-out frames —
satisfies Rule 9 (Plant-Health Output Discipline).

- **Research**: Pillow 12.2.0 (no advisories per `gh-advisory-database`),
  pure-Python imaging only — no numpy / cv2 / extra apt deps. Variance of
  `ImageFilter.FIND_EDGES` on the grayscale channel (border 1 px cropped
  to drop convolution wrap artefacts) ≈ Laplacian variance for blur;
  `ImageStat.Stat(L).mean[0]` for luminance. Calibration matrix recorded
  in `tests/test_image_quality.py`.
- **`app/errors.py`**: new `ImageQualityInconclusive(AnalysisError)` —
  code `IMAGE_QUALITY_INCONCLUSIVE`, status 422, retryable=False; `reason`
  is keyword-only and validated against `IMAGE_QUALITY_REASONS`
  (`image_decode_failed | image_too_large | image_too_small | too_dark |
too_bright | too_blurry`). Default message generic — never embeds pixel
  metrics.
- **`app/services/image_quality.py`**: pure `assess_image_quality(bytes)`
  pipeline — decode → decompression-bomb guard → minimum 64 px on each side →
  luminance window [15, 235] → edge-variance ≥ 50. Luminance check precedes
  blur check on purpose: a black image is "too dark", not "too blurry" (more
  actionable copy). Thresholds are module-level constants for one-place
  tuning.
- **`app/services/image_analysis.py`**: single-line wire-up between fetch and
  model. Existing `except AnalysisError` branch routes the new exception to the
  inconclusive fallback envelope automatically — no changes to the router, the
  response model, the web proxy, or shared contracts. Fallback telemetry now
  logs `image_quality_reason` for ops triage.
- **Tests**: `tests/test_image_quality.py` (+14 cases — happy path / RGB JPEG /
  decode-fail / decompression-bomb / empty bytes / too-small /
  under-exposed / over-exposed / blurred / uniform-grey /
  dark-wins-over-blurry / contract surface / unknown-reason guard);
  `tests/test_errors.py` (+1 case, extended redaction-safety check);
  `tests/test_image_analysis.py` (+2 integration cases proving
  `_run_model_analysis` is not called when the gate fails, the fallback log
  carries `image_quality_reason`, plus updated happy-path fixture to return a
  real PNG that passes the gate).

**Test count**: pytest 102/102 (was 86, +16). `ruff check .`, `mypy app/`,
`pnpm run validate`, `pnpm run security:routes`, CodeQL all clean.
Pillow added as the only new dep — pinned to 12.2.0.

**Next session**:

- No Tier 2 follow-up required on this branch; see the Tier 2 wrap-up entry
  above for merge / Tier 3 handoff.

---

## 2026-05-15 — Tier 2.1: per-user timezone for daily-summary + JSDoc cleanup (Copilot)

**In-flight on `copilot/assess-tier-1-and-plan-tier-2`**

First step of the Tier 2 plan (see PR description). Ships per-user
timezone support for the daily-summary cron and clears the only
unresolved Copilot review thread on PR #159 (JSDoc drift on
`emitFindingAlerts`).

- **Migration `017_user_preferences.sql`**: new `user_preferences`
  table (PK = `auth.users.id`), `timezone text not null default 'UTC'`,
  RLS (owner read + self upsert/update), BEFORE-trigger validates
  against `pg_timezone_names` (CHECK can't subquery), `updated_at`
  trigger.
- **`apps/web/src/lib/server/timezone.ts`**: `isValidTimezone` (uses
  `Intl.DateTimeFormat`) and `formatOccurredOnInZone` (uses `en-CA`
  to get YYYY-MM-DD without manual zero-pad). No new dep. **Optimization
  pass (2026-05-15 evening)**: added a per-process positive cache so the
  daily-summary cron stops constructing two `Intl.DateTimeFormat` per
  user (constructor is ~10–100× slower than `.format()`); validation
  and formatting now share one cache hit per IANA zone seen this
  process. Bounded by the IANA zone universe (~600). Test count went
  to 620/620 (+2 cache-coverage tests).
- **`apps/web/src/lib/server/user-preferences.ts`**: `loadUserPreferences`
  (single, RLS-scoped) and `loadUserPreferencesBulk` (cron path,
  service-role; backfills missing users to UTC default; query error
  degrades all to UTC rather than aborting the cron).
- **Cron `route.ts`**: bulk-loads preferences once, computes
  `occurred_on` per user via `formatOccurredOnInZone(startedAt, tz)`.
  Response payload retains UTC `occurredOn` for operator dashboards.
- **Settings page**: new "Timezone" card with a `<select>` of
  `Intl.supportedValuesOf("timeZone")` wired to `updateTimezoneAction`.
  Action edge-validates with `isValidTimezone`, maps SQLSTATE 22023 (the
  trigger) to "we don't recognise that timezone" copy, falls back to
  generic copy for everything else (no raw provider text).
- **JSDoc fix** on `notifications.ts:emitFindingAlerts`: the migration
  016 index has `kind` in the _predicate_, not the _key_; dedupe is
  app-level SELECT-then-INSERT with 23505 as a race backstop, not
  `ignoreDuplicates: true`.

**Test count**: 620/620 web pass (was 593, +27 across timezone /
user-preferences / settings action / cron route + cache coverage).
`pnpm run validate`, `pnpm run security:routes`, type-check, lint,
CodeQL all clean.

**Next session**:

- T2.2: Email delivery for `daily_summary` and critical
  `finding_alert` via Resend.
- T2.3: Strain-aware analysis context + per-finding confidence scores
  (contract-changing — needs `contract-guardian`).
- T2.4: Image quality validation in `apps/analysis` (blur / luminance
  pre-check, return inconclusive on bad input).

---

## 2026-05-15 — Notifications M2 server pipeline + post-wave drift cleanup (Claude Opus 4.7 / Copilot)

**Landed on `main` via PRs #152-#157 (HEAD `c495316`)**

Closed the type/scanner drift left over from the #137-#150 wave, fixed
two infra bring-up paper-cuts, and shipped the server side of the M2
"Proactive daily summary" milestone item.

- **#152 — type + scanner drift**: added `GrowTask` / `TaskPriority` /
  `TaskStatus` and `FindingSource` (`'ai' | 'user_reported'`) to
  `packages/shared/src/types.ts` to mirror migrations 008 + 010.
  `scripts/check-route-security.mjs` now detects re-exported handlers
  (`export { GET } from ...`); `/api/healthz` was previously skipped.
  Pinned by a new contract test that asserts `healthz.GET === health.GET`.
- **#153 — migration 003 fix**: qualified `storage.objects.name` inside
  the `plant-images: owner upload` policy. The previous `name` reference
  was ambiguous between `storage.objects.name` and `plants.name`, which
  aborted `supabase db push` on a fresh project (`42702`). Production
  was already applied with the corrected SQL via MCP.
- **#154 — migration 012_function_hardening**: closes Supabase advisor
  function-search-path warnings.
- **#155 — migration 013_pgvector_extensions_schema**: moves the
  `vector` extension out of `public` into an `extensions` schema, the
  idiomatic Supabase pattern. Auth-toggle docs updated alongside.
- **#156 — Notifications M2 (server side)**: migrations 014 + 015
  (notifications table, enums, RLS, partial UNIQUE scoped to
  `daily_summary`); `apps/web/src/lib/server/daily-digest.ts`
  (snapshot fan-out, prompt builder, Gemini renderer, priority mapper);
  `/api/internal/cron/daily-summary` handler with `CRON_SECRET` gate,
  batched fan-out (5 at a time), 45 s time budget, and
  `upsert(ignoreDuplicates: true)`. 583/583 web tests (+24). Dashboard
  badge / panel UI ships in a follow-up PR.
- **#157 — Railway start command**: wrapped the start command in a shell
  so `$PORT` expands at runtime instead of being passed as a literal.

**Test count**: 583/583 web pass, lint+type-check clean. CI green.

**Doc sync**: CHANGELOG, WORKLOG, roadmap, supabase-guide, product-spec
updated to reflect this wave (this entry).

**Next session**:

- M2 dashboard badge + panel + "mark as read" action for the new
  `notifications` feed (data is now flowing from cron).
- Per-user timezone support for `notifications.occurred_on` (currently
  UTC-day).
- Email delivery (Resend / SendGrid) for daily summaries.

---

## 2026-05-15 — Chat agentic tools wave + grow lifecycle + prod hardening (Claude Opus 4.7)

**Landed on `main` via PRs #137-#150 (HEAD `84ef964`)**

Two-month wave bringing the chat assistant from passive Q&A to a full
agentic copilot, plus completing the grow lifecycle and closing several
prod-hardening gaps.

- **Chat tools (read+write+entity-resolution)**: `create_grow` /
  `create_plants` / `create_grow_task` (#139), `update_grow` /
  `update_plant` (#140), `record_image_finding` with user-source RLS
  (#141), `get_plant_timeline` / `trigger_plant_analysis` (#142),
  `find_grow` / `find_plant` fuzzy resolvers (#143), `compare_plants` /
  `get_grow_summary` + system prompt refresh (#144). All tools covered
  by `chat-tools.test.ts`.
- **Grow lifecycle**: bulk plant create with auto-numbered names (#138),
  createGrow redirect-bug fix + reusable `useActionRecovery` hook (#145),
  detail page + archive flow + integrity migration 011 (partial UNIQUE
  on `(owner_id, lower(name)) WHERE NOT is_archived`) (#147), edit /
  stage advance / hard-delete on detail page (#150).
- **Prod hardening**: SSRF guard on analysis service `storage_path`
  (CodeQL #164) (#146), one-click Supabase migration apply via
  `workflow_dispatch` (#148), project-scoped Supabase MCP config (#149).
- **Migration drift repair**: production was missing history rows for
  003-010 (some DDL applied, some not). Applied + recorded all 11
  migrations against `yjemotnclrnlxgcfntaf`. Schema now matches repo.

**Test count**: 561/561 web pass, lint+type-check clean. CI green.

**Next session**: shared TS types lag migrations 008/010 (no `GrowTask`,
`PlantFinding.source` missing); `check-route-security.mjs` doesn't
detect re-exported HTTP handlers (`api/healthz` slips through).

---

## 2026-05-14 — Optimization bundle: chat-context parallel, createPlant fix, hot indexes (Claude Opus 4.7)

**Landed on `main` via PR #136 (commit `4e12dbd`)**

Second pass after #135. 3 parallel audit agents (perf+DB, security, UX) →
triaged → shipped only the verified high-confidence wins.

- **`createPlantAction` had the same redirect-from-await bug** as
  createGrowAction. Same fix: try/catch with `isNextFrameworkError`
  re-throw, return `{ status: "success", redirectTo }`, `router.push`
  from `plant-form.tsx`. Sanitized raw supabase error strings (was
  leaking `error.message` directly), added `logServerEvent` on failure,
  friendly `23505` duplicate-name message.
- **chat-context**: the 3 independent per-grow queries (plantCount,
  recent findings, open tasks) were serial. Now `Promise.all`-ed.
- **New migration `009_chat_and_findings_indexes.sql`** — adds two
  missing covering indexes:
  - `chat_threads(user_id, updated_at desc)` for `listThreadsForUser`
  - `plant_findings(grow_id, created_at desc)` for chat-context's
    last-30-days findings query
  - **Action item:** run `supabase db push` against prod to apply.
- **grow-form**: target-harvest-date input now has `min={startDate}` so
  the date picker can't pick a target before the start.
- **Tests:** 8 new cases for `createPlantAction`. Web at `417/417`
  (was 409). lint, type-check, build, check:env all green. Prod
  `/api/health` reporting `4e12dbd6...`.

Explicitly **skipped** (verified as non-issues or out of scope):
storage path collision (already UUID-namespaced), CSRF on server
actions (SameSite cookies cover same-origin), `WITH CHECK` policy
split (Postgres uses USING for INSERT when WITH CHECK absent),
relocating `security definer` (standard Supabase pattern), chat-context
caching (staleness risk).

---

## 2026-05-13 — Workspace-action error boundary + chat training-refusal fix (Claude Opus 4.7)

**Landed on `main` via PR #135 (commit `1b9b180`)**

QA report flagged the `(app)/error.tsx` "We couldn't load this workspace
view" page firing on **Create grow** and **Save display name**, plus the
chat refusing topping/LST advice when no grow ID was selected. Root
causes:

- `createGrowAction` ended with `redirect("/grows")`. Because the form
  awaits the server action manually inside `startTransition`, the
  `NEXT_REDIRECT` throw escaped to React's error boundary instead of
  triggering navigation. Switched to returning
  `{ status: "success", redirectTo }` and `router.push` from the client.
- Both `createGrowAction` and `updateDisplayNameAction` let supabase /
  env errors throw (most likely `getDbClient()` on a missing
  service-role credential in prod). Wrapped supabase work in `try/catch`
  that re-throws Next framework signals (`isNextFrameworkError`) but
  converts everything else into structured `{ status: "error", message }`.
  Defensive client `catch` added too.
- All caught errors now go through `logServerEvent("error", ...)` for
  prod debugging.
- Chat prompt: added an explicit "General knowledge vs grow-specific
  advice" section so the model never refuses topping / FIMing / LST /
  IPM / nutrient-schedule questions for lack of a grow ID. The system
  prompt already listed those as expertise; the new section makes the
  no-tool-needed rule unambiguous.

Tests: +12 cases covering success, supabase-error, supabase-throw,
NEXT_REDIRECT re-throw preservation, signed-out, validation-only, and
missing-service-role-key paths. Suite at 409/409.

Caveat: could not authenticated-browser-test the deployed flow. Fix is
defensive in depth — even if the prod env var is still misconfigured,
users now see a clear inline message instead of the digest page, and
the cause hits the server log.

---

## 2026-05-08 — UX walkthrough: signed-out CTAs + auth copy + alert focus (Claude Opus 4.7)

**Landed on `main`**

Posed as a real user and walked the deployed surface. Five concrete UX
defects fixed in one commit:

- Landing "View demo" CTA linked to `/dashboard`, which redirects to
  `/auth` for signed-out users — a broken promise. Replaced with a
  "See features" button that scrolls to a new `#pillars` anchor on the
  same page.
- Footer "Dashboard" link had the same problem; swapped for a "Features"
  anchor link.
- Auth page heading said "Welcome back", which is wrong for sign-up and
  magic-link users. Made the heading neutral ("Welcome") and updated the
  supporting copy to mention all three modes.
- Sign-in form `Feedback` alert had `role="alert"` but no auto-focus, so
  screen readers didn't get a priority announcement and keyboard users
  had to hunt for the message. Added a `useEffect` that focuses the
  alert on appearance, plus `tabIndex={-1}` and a focus ring.
- Mode-switch helper text ("Switch to Sign up above") was plain text.
  Converted to actionable `<button>` elements that flip mode and focus
  the matching tab in one click.

No server logic changed. Architecture rules unchanged. All 104 web tests
pass; type-check, lint, build, security:routes all clean.

---

## 2026-05-07 — Form a11y hardening + assistant boundary parity (Claude Opus 4.7)

**Landed on `main`**

Continuation of the UX-hardening pass. Focus: form error accessibility,
upload feedback semantics, and assistant route parity with the rest of
the app's error/loading boundaries.

- `feat(web)` — `apps/web/src/components/form-error-summary.tsx`. New
  shared client component that renders `role="alert"` + `aria-live=
"assertive"`, focuses itself on appearance (so screen readers
  announce), and lists field errors as deep-link anchors to each
  offending field. Returns null when the form is clean.
- `feat(web)` — `apps/web/src/app/(app)/grows/new/grow-form.tsx`:
  - Replaced inline server-error div with `FormErrorSummary` that
    receives the field-error map and a label/target-id meta map.
  - Every field now sets `aria-invalid` and `aria-describedby` linking
    to its `*-error` paragraph when an error is present.
  - Added `noValidate` so server-side validation owns the message
    surface (no duplicate browser tooltips).
  - Submit button now sets `aria-busy={isPending}`.
- `feat(web)` — `apps/web/src/app/(app)/plants/new/plant-form.tsx`: same
  treatment (FormErrorSummary, aria-invalid/describedby on grow + name
  fields, aria-busy on submit, noValidate on form).
- `feat(web)` — `apps/web/src/components/upload-photo-panel.tsx`: the
  notice region now switches between `role="status"` /
  `aria-live="polite"` for success/warning and `role="alert"` /
  `aria-live="assertive"` for danger, so upload failures are announced
  immediately. Submit gets `aria-busy` while uploading.
- `feat(web)` — `apps/web/src/app/assistant/error.tsx` and
  `apps/web/src/app/assistant/loading.tsx` bring the chat surface to
  parity with `(app)` and `auth`: a tailored ErrorFallback ("The grow
  copilot is unavailable right now") and a skeleton with `role="status"`
  - `aria-busy`.

**Validation**

- `pnpm run validate` — PASS
- `pnpm turbo run type-check lint test` — PASS (104 / 104 web, 5 / 5 shared)
- `pnpm --filter web build` — PASS (12 / 12 static pages)
- `pnpm run security:routes` — PASS (9 routes scanned)

**Notes / follow-ups**

- `FormErrorSummary` and the upload region updates are presentational;
  no unit tests because vitest still has no `@vitejs/plugin-react`.
  Adding RTL infra is queued as its own iteration.
- Plant detail / timeline page still relies on server-rendered empty
  states; if any client-side fetches are added later, they need the
  same role="alert" + aria-busy treatment.

---

## 2026-05-07 — DRY error boundaries + workspace loading state (Claude Opus 4.7)

**Landed on `main`**

Builds on `6edc55f` (segment + global error boundaries) and `6026f21`
(force-dynamic for `(app)`). Adds:

- `feat(web)` — `apps/web/src/components/error-fallback.tsx`, a shared
  presentational component used by every route-level error boundary so
  users see a uniform error card (eyebrow, alert heading, plain-language
  description, optional digest reference, Try-again + secondary link).
- `feat(web)` — `apps/web/src/app/(app)/error.tsx` and
  `apps/web/src/app/auth/error.tsx`: per-segment error boundaries with
  copy tailored to each surface, both delegating to `ErrorFallback`.
- `refactor(web)` — `apps/web/src/app/error.tsx` now delegates to the
  shared `ErrorFallback` instead of inlining its own card markup.
  `global-error.tsx` is intentionally kept self-contained (no design
  system) because it runs when the layout itself can't render.
- `feat(web)` — `apps/web/src/app/(app)/loading.tsx`, a skeleton shell
  with `role="status"` + `aria-busy` so workspace navigations show a calm
  loading surface instead of a blank screen.
- `fix(web)` — `apps/web/src/app/(app)/layout.tsx` re-throws Next.js
  control-flow signals (NEXT_REDIRECT, NEXT_NOT_FOUND,
  DYNAMIC_SERVER_USAGE) untouched from its profile-load try/catch via the
  new `isNextFrameworkError()` helper. Defense-in-depth on top of
  `force-dynamic`.
- `feat(web)` — `apps/web/src/lib/server/auth-errors.ts` exports
  `isNextFrameworkError()` plus 2 new tests. Web suite now 104 / 104.

**Validation**

- `pnpm run validate` — PASS
- `pnpm turbo run type-check lint test` — PASS (104 / 104 web, 5 / 5 shared)
- `pnpm --filter web build` — PASS (12 / 12 static pages, no spurious logs)
- `pnpm run security:routes` — PASS (9 routes scanned)

**Notes / follow-ups**

- The shared `ErrorFallback` is a client component; vitest is configured
  for `node` env without `@vitejs/plugin-react`, so it has no unit tests.
  Adding component tests would require introducing jsdom +
  `@testing-library/react` + the React plugin. Out of scope; behavior is
  exercised by the build's static prerender of `/not-found` (same
  primitives) and the route boundaries themselves.
- Upload, analysis, chat, and timeline error UX still need the same audit
  pass — next iteration.

---

## 2026-05-07 — Auth UX hardening: kill "fetch failed" (Claude Opus 4.7)

**Landed on `main`**

- `fix(web)` — production sign-in/sign-up surfaced a generic "fetch failed"
  message because raw Supabase / undici errors were rendered straight from
  `error.message`. Added `apps/web/src/lib/server/auth-errors.ts` with a
  central `describeAuthError()` mapper that prefers stable fields
  (`name === "AuthRetryableFetchError"`, `code`, `status`) over message
  substrings, plus `AuthConfigError`, `getAuthConfigViolations()`, and
  `isNextRedirectError()`/`isNextNotFoundError()` helpers.
- `fix(web)` — `apps/web/src/lib/server/auth.ts` now throws `AuthConfigError`
  early if `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` are missing/malformed, so a
  misconfigured Vercel deploy fails loudly instead of bubbling a TypeError
  out of Supabase's fetch layer. Added `tryGetServerUser()` for places that
  must keep rendering when auth is unreachable.
- `fix(web)` — `apps/web/src/app/auth/actions.ts` rewritten: each action
  pre-validates env, wraps the Supabase call in try/catch, re-throws
  `NEXT_REDIRECT`/`NEXT_NOT_FOUND` digests, and returns
  `{ ok, message, email }` so the form can repopulate the email after a
  failure. `signOutAction` now redirects home even if Supabase is down.
- `fix(web)` — `apps/web/src/app/auth/page.tsx` uses `tryGetServerUser()`
  and shows `AUTH_MISCONFIGURED` as the initial error if env is missing.
- `fix(web)` — `apps/web/src/app/auth/sign-in-form.tsx` threads the
  preserved email back via `defaultValue` and uses `key` to remount the
  form when the echoed email changes (handles uncontrolled inputs cleanly).
- `fix(web)` — `apps/web/src/app/auth/callback/route.ts` translates
  `exchangeCodeForSession` errors and config/fetch failures via the new
  helper, and closes a protocol-relative open-redirect (`//evil.com`) in
  the `next` param.
- `fix(web)` — `apps/web/src/app/(app)/layout.tsx` catches profile-load
  failures and redirects to `/auth?error=...` instead of crashing the
  authenticated shell when the DB is unreachable.
- `test(web)` — added `auth-errors.test.ts` (15 cases) and
  `app/auth/__tests__/actions.test.ts` (14 cases): validation, env-missing,
  thrown-fetch-failure, returned `AuthRetryableFetchError`,
  invalid-credentials mapping, success redirect, OTP success, sign-out
  resilience. Web suite now 102/102 green (was 73/73).

**Validation run for this change**

- `pnpm run validate` → PASS
- `pnpm turbo run type-check lint` → PASS
- `pnpm turbo run test` → PASS (102/102 in web, shared cached)
- `pnpm --filter web build` → PASS (with stub envs)
- `pnpm run security:routes` → PASS

**Production env action required (NOT a code change)**

- The user-visible "fetch failed" symptom in the live deploy is consistent
  with one or both of `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  being absent or malformed in the Vercel **Production** environment.
  After this change the page surfaces `AUTH_MISCONFIGURED` instead of
  "fetch failed", but the underlying env still has to be filled in for
  auth to actually work end-to-end. Verify in Vercel project settings.

**Intentionally not changed**

- No `middleware.ts` introduced.
- No migration edits.
- Architecture boundaries (browser → Vercel only; analysis via server
  proxy) untouched.
- Did not add Playwright E2E in this PR — pre-existing follow-up.

---

## 2026-05-07 — Agent operating-model alignment (Claude Opus 4.7)

**Landed on `main`**

- `docs(agents)` — codified the plant-health output-discipline rule
  (inconclusive / non-diagnostic state, no fallback-as-diagnosis) as
  `.github/copilot-instructions.md` §9. The behavior already lives in
  `apps/analysis/app/services/image_analysis.py` and the upload/plant UI;
  this just makes it a load-bearing AI-agent rule.
- `docs(agents)` — aligned §8 Validation Commands with `AGENTS.md` by
  adding `pnpm run security:routes` and `pnpm run pr:guardian` so the three
  agent docs (AGENTS.md, CLAUDE.md, copilot-instructions.md) reference the
  same gates.

**Intentionally not changed**

- AGENTS.md and CLAUDE.md — already concise and consistent; no edits.
- PR template — already covers validation, scope, forbidden changes,
  affected boundaries, and rollback.
- No prettier sweep across the repo (`format:check` remains advisory in CI
  per the 2026-04-18 entry; touched files were kept formatted).

**Validation run for this change**

- `pnpm run validate` → PASS
- `pnpm run security:routes` → PASS
- `pnpm run format:check` on edited files → PASS (repo-wide check still
  advisory, unchanged from prior session).

**Open follow-ups (carried forward from 2026-04-18)**

- Playwright not installed in CI yet; deliberate browser-install step still
  pending.
- Sentry DSN not provisioned in Vercel/Railway env.
- `format:check` still advisory in CI.
- ~~`pnpm audit` still flags 2 moderate advisories per Dependabot.~~ Updated:
  postcss advisory cleared via `pnpm.overrides` (`postcss@<8.5.10` →
  `>=8.5.10`). Two open advisories remain (`vite ≤ 6.4.1`, `esbuild ≤ 0.24.2`)
  and require a vitest 2 → 3 upgrade. Tracked as the next dep-bump PR.
- ~~Two open advisories remain (`vite`, `esbuild`)~~ Cleared in a follow-up
  commit: bumped `vitest` 2 → 3 in both `apps/web` and `packages/shared`,
  added `vite ^6.4.2` and `esbuild ^0.25.0` to `pnpm.overrides`, all 78 tests
  still pass under the new toolchain.

---

## 2026-04-18 — Production-hardening sweep (Claude Opus 4.7)

**Landed on `main`**

- `build(tooling)` — Turbo, Prettier, Husky, commitlint, tsconfig.base
- `test` — Vitest (web+shared), Playwright scaffolding, pytest-cov
- `ci` — parallel jobs, harden-runner, bundle size, route security audit
- `feat(observability)` — `/ready` endpoints, telemetry bootstrap, `useServiceHealth`
- `feat(security)` — CSP, env validator, rate limiter, security-audit script
- `chore(claude)` — 10 skills, 2 hooks, contract-guardian agent, 2 commands
- `docs` — CLAUDE.md, AGENTS.md, CHANGELOG.md, this file, runbooks
- `feat(pr-guardian)` — file/line caps + PR template revision

**Known-unblocked follow-ups**

- Playwright: `@playwright/test` not installed; wire into CI after a deliberate
  browser-install step (adds ~200MB to CI cache).
- Sentry DSN not yet provisioned — `SENTRY_DSN` is read at boot, so the moment
  DSNs land in Vercel + Railway env, error reporting starts without a deploy.
- `format:check` is advisory in CI — flip to hard once the tree is fully
  Prettier-formatted (the pre-commit hook keeps new files in line).
- `pnpm audit` wired into `scripts/security-audit.mjs` — currently 2 moderate
  advisories on `main` per GitHub Dependabot; review and patch.

**Dead ends (don't repeat)**

- `exactOptionalPropertyTypes: true` at the base TS config breaks
  `fetch(..., { body: undefined })` patterns. Fix is to build the `RequestInit`
  imperatively (see `apps/web/src/lib/server/analysis-proxy.ts:22`).
- Husky v9 deprecates the `#!/usr/bin/env sh` + `source husky.sh` preamble.
  Hooks are now single-line commands (`.husky/pre-commit`, `.husky/commit-msg`).
- `asyncio_mode = "auto"` conflicts with existing explicit `@pytest.mark.asyncio`
  markers in `apps/analysis/tests`. Kept `strict`.

**Next session should…**

1. Trigger a Vercel prod redeploy (push to `main` above already did) and
   verify `/api/health` + `/api/ready` return 200.
2. Redeploy Railway analysis and verify `/health` + `/ready`.
3. Open a throwaway PR to confirm `ci-status` job + PR template work.
4. If Sentry is desired, create project via Sentry MCP and drop DSNs into
   Vercel / Railway env. No code change required.
