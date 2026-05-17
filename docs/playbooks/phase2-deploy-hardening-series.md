# Phase 2 Deployment Hardening — 6-PR Series Handoff

Last updated: 2026-05-17 · Owner: @stevenschling13

This is a self-contained handoff for the Phase 2 deployment-hardening series.
If you are an AI agent (Claude Code, Copilot Task Agent, Codex) picking up one
of the PRs below, **read this top-to-bottom before doing anything else**. Each
PR is independent and revertable. Land them in the recommended order
(`e → a → c → b → d → f`); do not combine.

> Why a series and not one PR: `.github/copilot-instructions.md` §7 and
> `AGENTS.md` cap PRs at ≤ 30 files / ≤ 1,500 lines and "one concern per PR".
> Each slice below fits under those caps and is independently revertable.

**Authoritative scope sources:**

- PR #184 description, section _"What's deliberately deferred (Phase 2 items)"_.
- `docs/runbooks/slo.md` §"Error rate" (the error-rate auto-rollback gap) and
  the DORA-CFR follow-up referenced under §"Deploy reliability".

---

## 0. Quick-start (every session)

```bash
cd /home/runner/work/PhenoSage/PhenoSage   # or wherever the repo lives
git fetch origin main
git checkout -b copilot/phase2-<slice>  origin/main

# Healthy baseline before touching anything:
pnpm install --frozen-lockfile
pnpm run validate
pnpm turbo run type-check lint test
pnpm run security:routes
```

If any of the four commands above is red on `main`, **stop**. Fix the baseline
first or surface it in the PR description — do not start Phase 2 work on a
broken tree.

When done, update `WORKLOG.md` with what landed (SHA), what's in-flight (branch

- PR link), and any dead ends. This is required by `AGENTS.md` §Handoff.

---

## 1. Shared rules for every PR in this series

These apply to all six slices. Violating any of them means the PR should be
rejected in review:

1. **One concern per PR.** Workflow-only slices (a, b CI half, c, e) touch
   only `.github/workflows/**` plus the explicitly named docs. Slice (d)
   touches `apps/web/src/app/api/internal/**` only. Slice (f) is the only
   slice that adds a runtime dependency.
2. **Do not weaken the security boundary.** No edits to CSP / security headers
   in `apps/web/next.config.mjs`, no weakening of RLS, no new public Supabase
   Storage buckets, no `middleware.ts`, no fetching the analysis service from
   client code. (See `.github/copilot-instructions.md` §1, §6.)
3. **Never weaken the env contract.** No secret in a `NEXT_PUBLIC_*` var. Any
   new env var goes in both `.env.example` and the contract enforced by
   `scripts/check-env-contract.mjs`.
4. **Never add `--no-verify`, `--no-gpg-sign`, or `git push --force`** (per
   `AGENTS.md` Forbidden actions). Also: never `git push --force` to a branch
   an open PR is tracking.
5. **Preserve `step-security/harden-runner`** on every job. Do not change
   `egress-policy` from `audit` to anything looser in the same PR.
6. **Preserve `concurrency:` cancel-in-progress** at the workflow level on
   every existing workflow you touch.
7. **Keep `permissions:` minimum-scoped.** If a slice needs a new permission,
   add it on the specific job, not at the workflow root.
8. **Pin third-party Actions to a full commit SHA**, with a brief note in
   the PR description on why the action is needed. Prefer first-party or
   already-used actions.
9. **Degrade gracefully when secrets are absent.** Phase 1 (PR #184) set the
   precedent: missing `VERCEL_TOKEN` / `DISCORD_WEBHOOK_URL` / `SENTRY_*`
   silently disables the optional step instead of failing the workflow. Phase
   2 slices must follow the same pattern.
10. **Plant-health output discipline still applies.** If any new probe or
    status surface can produce a misleading answer when an upstream is down,
    it must surface an explicit inconclusive / not-ready state, not a
    confident "ok". (See `.github/copilot-instructions.md` §9.)

---

## 2. The six slices

### PR (a) — Error-rate probe in `post-deploy-smoke.yml`

**Goal.** Close the load-bearing Phase 2 gap: today the smoke job only checks
endpoint health, headers, and secret-leak patterns. A deploy that quietly
spikes 5xx or Server Component throws won't trigger auto-rollback. The SLO
doc already promises this in §"Error rate" lines 68–70.

**In scope.**

- Add a step to `.github/workflows/post-deploy-smoke.yml` that, after the
  existing smoke check passes, queries error counts for the just-deployed
  release over a short window (default 5 min):
  - **Preferred source:** Vercel runtime logs via the existing `VERCEL_TOKEN`
    (Vercel Logs API), filtered to the just-promoted deployment ID.
  - **Fallback source:** Sentry `events` or `releases/.../resolved` API
    scoped to the `release` tag pushed by `release-on-prod-deploy.yml`.
- Threshold expressed as workflow env vars (one place to tune):
  - `ERROR_RATE_THRESHOLD` (default `0.01` = 1% of requests in the window).
  - `ERROR_ABSOLUTE_FLOOR` (default `5` 5xx responses) to handle low-traffic
    windows where the ratio is statistically meaningless.
- On breach: reuse the existing rollback path from Phase 1 (Vercel promote
  API → previous READY deploy, open issue with the probe receipt, Discord
  alert). **Do not add a second rollback implementation.**
- Degrade gracefully when `SENTRY_AUTH_TOKEN` and Vercel Logs API both fail
  or are unconfigured — write a "probe skipped: <reason>" line to the run
  summary and let smoke pass.

**Out of scope.**

- New rollback machinery. The Phase 1 promote-API call is reused.
- Editing `next.config.mjs`, CSP, or any runtime code.
- Wiring Sentry into `apps/web` — that's slice (b).
- Issue templates / labels (use whatever Phase 1 already opens).

**Validation.**

```bash
pnpm install --frozen-lockfile
pnpm run validate
pnpm turbo run type-check lint test
pnpm run security:routes
```

Plus a `workflow_dispatch` dry-run on a non-prod branch with all optional
secrets unset, to prove the new step degrades gracefully.

**Stop condition.** The dry-run shows the probe step running, reporting
"probe skipped: no token" (or similar) when secrets are absent, and the
smoke job still goes green. Open the PR; do not start (b).

---

### PR (b) — Sentry verification

**Goal.** Make sure Sentry is actually wired end-to-end and that a missing
half of the configuration fails CI rather than failing silently in prod.

**In scope.**

- Add a CI check (in `ci.yml` or a small dedicated workflow) that fails if
  the repo references `SENTRY_DSN` in client code but `SENTRY_AUTH_TOKEN`
  isn't in the env contract — or vice versa. Implement as a small Node
  script invoked from a workflow step; do not add a new linter.
- Add a one-shot post-deploy step (in `release-on-prod-deploy.yml` or a
  sibling triggered on the same event) that hits Sentry's API to confirm
  the release tag just pushed actually shows up in Sentry. If it doesn't,
  open an issue (label e.g. `phase2:sentry-release-missing`). **Do not
  rollback** — Sentry being late is not a user-facing failure.
- Update `docs/deployment.md` "Required GitHub secrets" table to include
  `SENTRY_AUTH_TOKEN` and any new vars.
- Extend `scripts/check-env-contract.mjs` allowlist for any new vars added
  to `.env.example` (memory: the contract is currently out of sync with the
  example for `SENTRY_*` / `OTEL_*`; that drift is a separate concern, do
  not bundle the full sync into this slice — only add what this slice
  introduces).

**Out of scope.**

- Wiring `@sentry/nextjs` in `apps/web` runtime code. If Sentry is not yet
  initialised, file a separate issue and document it in the PR body; this
  slice only verifies _configuration_, it does not introduce instrumentation.
- Replacing or restructuring the rollback path.

**Validation.** Standard gate (§3 below). Confirm the new CI check fails
when you deliberately remove `SENTRY_DSN` from a fixture, then put it back.

**Stop condition.** The check fails on a deliberately mis-configured
fixture, passes on the real config, and the post-deploy verification step
runs (or skips gracefully) on the PR's own deploy.

---

### PR (c) — DORA-metrics-to-CHANGELOG automation

**Goal.** Make Change Failure Rate visible and auditable, per `slo.md` line 79.

**In scope.**

- Extend `.github/workflows/track-followups.yml` (or add a sibling) with a
  weekly `schedule:` trigger to:
  - Compute deploy count from tags pushed by `release-on-prod-deploy.yml`
    (format `vYYYY.MM.DD-N`) over the trailing 30 days.
  - Compute failure count from:
    - Issues opened by the Phase 1 auto-rollback path with a known label
      (use whatever label Phase 1 already applies; do not invent a new one
      without checking).
    - Commits to `main` within 6h of a deploy tag whose conventional-commit
      type is `fix` or `revert`.
- Write the rolling 30-day CFR to a fenced block in `docs/metrics/dora.md`
  (new file, JSON-in-fences for easy machine read) **via a PR**, not a
  direct push to main. Use `peter-evans/create-pull-request@<sha>` or
  equivalent. The PR opener has minimum-scoped `permissions:`.
- Label the auto-opened PR (e.g. `phase2:dora-update`) so it's easy to
  auto-merge or filter.

**Out of scope.**

- Editing `CHANGELOG.md` if it doesn't already exist (don't create a new
  CHANGELOG just to host one block; prefer the dedicated `docs/metrics/`
  file).
- Computing latency or availability SLO numbers — only CFR + deploy count
  in this slice.
- Publishing to anywhere other than the repo (no external dashboards).

**Validation.** Standard gate. Manually invoke the workflow via
`workflow_dispatch` and confirm a draft PR is opened with believable
numbers.

**Stop condition.** Manual dispatch opens a PR with the fenced DORA block
populated. Do not also wire up alerting on the number — that's a future
concern.

---

### PR (d) — `/api/internal/status` consolidated dashboard

**Goal.** One JSON endpoint summarising deploy + smoke + cron + error-budget
state, so on-call doesn't have to bounce between five tabs.

**In scope.**

- New Route Handler `apps/web/src/app/api/internal/status/route.ts`:
  - Server-only. Gated by `Authorization: Bearer ${CRON_SECRET}` — the same
    pattern as `apps/web/src/app/api/internal/cron/daily-summary/route.ts`
    (see repo memory: cron-auth).
  - Returns JSON aggregating:
    - Last successful prod deploy tag (from GitHub Releases API).
    - Current smoke status (last `post-deploy-smoke.yml` run conclusion).
    - Last rollback receipt (issue opened by the Phase 1 auto-rollback
      path) if any.
    - Last `daily-summary` cron run timestamp.
    - Error budget remaining for the current month (computed from the SLO
      doc's 99.5% target, requires after slice (a) lands so the probe
      output is available — but compute from public smoke-run history if
      Sentry isn't wired yet).
  - All upstream calls must time out (≤ 3s each) and individually degrade
    to `"unknown"` / `null` per field. The overall response must always
    distinguish `"ok" | "degraded" | "unknown"` per the plant-health output
    discipline rule.
- Server-only fetches go through `apps/web/src/lib/server/**`. Tests added
  alongside under `__tests__/`.
- Update `docs/runbooks/on-call.md` to point at the new endpoint and show a
  one-line `curl` invocation.

**Out of scope.**

- A browser-facing HTML page. JSON only in this slice.
- Schema changes / new migrations / new tables.
- Edits to `packages/shared/src/types.ts` (the response shape lives next to
  the route).
- Adding new external API integrations beyond GitHub + (optionally) Vercel
  and Sentry, all using existing secrets.

**Validation.** Standard gate. Tests cover: happy path, each upstream
timing out, missing `CRON_SECRET` (returns 401), wrong bearer (returns
401).

**Stop condition.** `curl -H "Authorization: Bearer $CRON_SECRET"
https://.../api/internal/status` returns a 200 with the full envelope on
preview. Don't render a UI in this slice.

---

### PR (e) — Pre-deploy checklist gate

**Goal.** Smallest, most isolated slice. Make the existing PR-template "Test
plan" checklist actually enforceable.

**In scope.**

- New workflow `.github/workflows/pre-deploy-checklist.yml`:
  - Triggers on `pull_request` (types: `opened`, `edited`, `synchronize`,
    `ready_for_review`) targeting `main`.
  - Parses the PR body for the fenced "Test plan" checklist used in the
    repo's PR template.
  - Fails the check if any required item is unchecked.
  - Skips for PRs labelled `guardian:approved` (same waiver pattern as
    `scripts/pr-guardian.mjs`).
- Document in `docs/deployment.md` how to mark this as a required status
  check in branch protection (operator action only — branch protection
  cannot be configured from code in this repo).

**Out of scope.**

- Changing the PR template itself.
- Adding any other checklist-style gates.
- Touching runtime code.

**Validation.** Standard gate. Open a draft PR with an unchecked Test plan
item and confirm the check fails; check it and confirm the check passes.

**Stop condition.** Both scenarios above behave as expected.

---

### PR (f) — Vercel Flags integration scaffold

**Goal.** Land the smallest possible server-only scaffold for feature flags
so future feature work can adopt the pattern incrementally.

**In scope.**

- Run `gh-advisory-database` against the chosen flags package version
  (likely `@vercel/flags`) **before** adding it to `apps/web/package.json`.
- Add the SDK to `apps/web` dependencies only. Lockfile updated via
  `pnpm install`.
- New server-only module `apps/web/src/lib/server/flags.ts` with `import
"server-only"` at the top. Defines one demo flag (e.g. `phase2Demo`) that
  always returns `false` by default.
- A unit test under `apps/web/src/lib/server/__tests__/flags.test.ts`.
- Document the rollout pattern in `docs/deployment.md`:
  - All flags are server-evaluated only.
  - Never `NEXT_PUBLIC_*` a flag value.
  - Flag identifiers are committed in code; flag _values_ live in Vercel.

**Out of scope.**

- Wiring the demo flag into any user-facing surface.
- Adding a `/api/flags` endpoint, or any browser-readable flag value.
- Touching `next.config.mjs`, CSP, or the env contract beyond adding
  whatever the SDK requires (and adding it to `scripts/check-env-contract.mjs`
  if so).

**Validation.** Standard gate **plus** `pnpm run build` (this is the only
slice that touches `apps/web` runtime code).

**Stop condition.** `pnpm run build` is green, the test asserts the demo
flag returns `false`, and no browser-imported file imports the new module
(verified by `pnpm run security:routes` and route-boundary checker).

---

## 3. Validation gate for every slice

```bash
pnpm install --frozen-lockfile
pnpm run validate
pnpm turbo run type-check lint test
pnpm run security:routes
```

Slice (f) additionally requires `pnpm run build`. Slice (a) additionally
requires a `workflow_dispatch` dry-run of `post-deploy-smoke.yml` on a
non-prod branch with optional secrets unset, to confirm graceful degradation.

If `apps/analysis/**` is touched (it shouldn't be — that's out of scope for
the whole series), also run:

```bash
cd apps/analysis && ruff check . && mypy app/ && pytest --cov=app
```

---

## 4. Recommended order and dependencies

Recommended order: **e → a → c → b → d → f**.

- **(e) first** — smallest, no runtime risk, validates the agent loop on
  workflow-only changes.
- **(a) next** — closes the load-bearing SLO gap (error-rate
  auto-rollback). Highest user value.
- **(c) before (b)** — DORA automation is pure CI and doesn't depend on
  Sentry being wired; Sentry verification (b) wants `SENTRY_DSN` actually
  set in prod first.
- **(d) after (b)** — the `/api/internal/status` endpoint benefits from
  Sentry being verified so it can include error-budget data accurately.
  Can still land before (b) with the error-budget field falling back to
  `"unknown"`.
- **(f) last** — only slice that touches `apps/web` runtime code; do it on
  a clean tree once a–e are stable.

Slices (a) and (e) are independent of each other and can swap order safely.
Slices (b), (c), (d), (f) should not swap with anything earlier in the list.

---

## 5. Out of scope for the entire series

- Schema changes or new migrations.
- Any change to `packages/shared/src/types.ts` or
  `apps/analysis/app/models/**`.
- Editing existing migrations under `supabase/migrations/**`.
- A browser-facing status page (slice (d) is JSON-only by design).
- New databases, native mobile code, social / community / e-commerce
  features (all forbidden by `.github/copilot-instructions.md` §6).
- Adding a `middleware.ts` to `apps/web`.
- Removing or weakening `step-security/harden-runner`, `concurrency`, or
  job-scoped `permissions:` in any workflow this series touches.

---

## 6. How to prompt the next session

Open a fresh Copilot Task Agent / Claude Code / Codex session **per slice**.
Use the template below verbatim, swapping the slice letter. The agent will
then read this file (it is committed in the repo) for full context.

```
Implement PR (<a|b|c|d|e|f>) of the Phase 2 deployment hardening series.

Authoritative plan: docs/playbooks/phase2-deploy-hardening-series.md
Read that file end-to-end before touching anything.

Rules:
- Stay strictly within "In scope" for the slice. If you would touch
  anything in "Out of scope" — for this slice or for the whole series —
  stop and surface it in the PR description instead.
- Follow §1 "Shared rules for every PR in this series".
- Run the slice's "Validation" commands locally before opening the PR.
- Stop at the slice's "Stop condition" — do not start the next slice.
- Degrade gracefully when secrets are absent (Phase 1 precedent).

When done:
1. Open one PR with the slice letter in the title, e.g.
   "feat(deploy): phase2(a) error-rate probe in post-deploy smoke".
2. In the PR body, include:
   - What the slice does and what it deliberately does not do.
   - Output of the validation gate.
   - Any graceful-degradation behaviour you proved (esp. for slice a).
3. Update WORKLOG.md per AGENTS.md §Handoff.
```

---

## 7. Cross-links

- `.github/copilot-instructions.md` — non-negotiable repo rules
- `AGENTS.md` — universal agent playbook (PR caps, sensitive paths,
  validation, handoff)
- `CLAUDE.md` — architecture + commands + sensitive paths
- `docs/runbooks/slo.md` — the SLO numbers this series is hardening
- `docs/runbooks/rollback.md` — the manual rollback procedure
- `docs/runbooks/on-call.md` — slice (d) updates this
- `docs/deployment.md` — slices (b), (e), (f) update this
- `docs/playbooks/ci-optimization-series.md` — the precedent this doc is
  modeled on
- `docs/playbooks/repo-aware-ai-coding-playbook.md` — operating model
