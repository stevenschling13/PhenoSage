# CI Optimization — 4-PR Series Handoff

Last updated: 2026-05-16 · Owner: @stevenschling13

This is a self-contained handoff for the CI-optimization series. If you are an
AI agent (Claude Code, Copilot Task Agent, Codex) picking up one of the PRs
below, **read this top-to-bottom before doing anything else**. Each PR is
independent and revertable. Land them in order (a → b → c → d); do not
combine.

> Why a series and not one PR: `.github/copilot-instructions.md` §7 and
> `AGENTS.md` cap PRs at ≤ 30 files / ≤ 1,500 lines and "one concern per PR".
> Each slice below fits under those caps and is independently revertable.

---

## 0. Quick-start (every session)

```bash
cd /home/runner/work/PhenoSage/PhenoSage   # or wherever the repo lives
git fetch origin main
git checkout -b copilot/ci-opt-<slice>  origin/main

# Healthy baseline before touching CI:
pnpm install --frozen-lockfile
pnpm run validate
pnpm turbo run type-check lint test
pnpm run security:routes
```

If any of the four commands above is red on `main`, **stop**. Fix the baseline
first or surface it in the PR description — do not start CI work on a broken
tree.

When done, update `WORKLOG.md` with what landed (SHA), what's in-flight (branch
+ PR link), and any dead ends. This is required by `AGENTS.md` §Handoff.

---

## 1. Shared rules for every PR in this series

These apply to all four slices. Violating any of them means the PR should be
rejected in review:

1. **Workflow-only changes by default.** Touch files under
   `.github/workflows/**`, plus `turbo.json` or `package.json` scripts only
   when the slice's scope explicitly calls for it. Do not touch application
   code, migrations, shared types, or `next.config.mjs`.
2. **Never weaken security headers, RLS, route boundaries, or the env
   contract** to make CI faster. If a check fails because of legitimate code
   issues, that is out of scope — file a separate issue.
3. **Never add `--no-verify`, `--no-gpg-sign`, or `git push --force`** (per
   `AGENTS.md` Forbidden actions).
4. **No new third-party Actions without pinning to a SHA** and a brief note in
   the PR description on why it is needed. Prefer first-party or already-used
   actions.
5. **Preserve `step-security/harden-runner`** on every job. Do not change
   `egress-policy` from `audit` to anything looser in the same PR.
6. **Preserve `concurrency:` cancel-in-progress** at the workflow level.
7. **Keep `permissions:` minimum-scoped.** If a slice needs a new permission,
   add it on the specific job, not at the workflow root.
8. **Each PR must measure its own win.** Include before/after wall-clock
   timings for at least one representative run in the PR description.

---

## 2. The four slices

### PR (a) — Turbo orchestration + dependency caches + per-job timeouts

**Goal.** Cut redundant work and bound runaway jobs.

**In scope.**

- Replace per-package `pnpm --filter web ...` step sequences in
  `.github/workflows/ci.yml` with `pnpm turbo run <task>` where the same task
  already exists in `turbo.json`, so Turbo's local cache and task graph are
  used.
- Add an `actions/cache` step for the Next.js build cache
  (`apps/web/.next/cache`) keyed on lockfile + source hashes.
- Add `actions/setup-python` with `cache: "pip"` plus
  `cache-dependency-path: apps/analysis/requirements*.txt` to the analysis job.
- Cache `~/.cache/ruff` and `.mypy_cache` for the analysis job.
- Add `timeout-minutes:` to every job (suggested defaults: 10 for validate /
  audits, 20 for web build/test, 15 for analysis).

**Out of scope.**

- Anything in `apps/web/**` or `apps/analysis/**` source.
- Adding new Actions, splitting workflows, or matrix strategies (that is PR
  b/d).
- Touching `turbo.json` pipeline definitions other than declaring `outputs`
  for tasks that need them so Turbo can cache properly.

**Validation.**

```bash
pnpm install --frozen-lockfile
pnpm run validate
pnpm turbo run type-check lint test
```

**Stop condition.** When a clean push run completes ≥ 30% faster than the
baseline captured in the PR description, stop and open the PR. Do not also
implement (b).

---

### PR (b) — Docker buildx layer cache + analysis test matrix

**Goal.** Speed up the docker-compose-driven CI path and parallelize the
analysis test suite.

**In scope.**

- Add `docker/setup-buildx-action` + `cache-from: type=gha` /
  `cache-to: type=gha,mode=max` to whichever job in `.github/workflows/ci.yml`
  builds images via `docker-compose.ci.yml`.
- Convert the analysis pytest step to a small matrix
  (e.g. `strategy.matrix.shard: [1, 2]` with `pytest --shard` or
  `pytest-split`) **only if** the analysis suite is already >60s; otherwise
  document why and skip the matrix.
- Add `fail-fast: false` to any new matrix.

**Out of scope.**

- Changing the docker-compose file itself (other than env passthrough already
  required by it — see memory: `docker-compose.ci.yml` requires
  `POSTGRES_PASSWORD`).
- Introducing a Dockerfile change.
- Touching the web build cache (already done in PR a).

**Validation.** Same as PR (a) plus a green CI run on the PR itself
demonstrating the new cache hit on a follow-up commit.

**Stop condition.** Cache hit shows on the second push (look for
`importing cache manifest` in the build log) and the analysis matrix
parallelizes cleanly.

---

### PR (c) — Supply-chain scanning: dependency-review + Trivy fs

**Goal.** Catch vulnerable dependencies and IaC issues at PR time, on top of
the existing CodeQL, gitleaks, and scorecard workflows.

**In scope.**

- Add `actions/dependency-review-action@<sha>` as a PR-only job. Configure to
  fail on `high` and above; allow waivers via the existing
  `guardian:approved` label.
- Add `aquasecurity/trivy-action@<sha>` in `fs` mode against the repo root,
  outputting SARIF to the Security tab. Fail on `CRITICAL` only initially.
- Both jobs must run with `permissions: { contents: read, security-events:
  write, pull-requests: read }` scoped at the job level.

**Out of scope.**

- Replacing CodeQL, gitleaks, or scorecard.
- Adding container image scanning (separate future PR).
- Editing dependency versions to clear findings — file follow-up issues
  instead, do not bundle fixes here.

**Validation.**

- `pnpm run validate && pnpm run security:routes`
- Confirm both new jobs appear in the PR's Checks tab and SARIF lands in the
  Security tab.

**Stop condition.** Both scanners run green (or surface real findings, which
should be filed as issues — not fixed in this PR).

---

### PR (d) — `merge_group` trigger + path-based skips

**Goal.** Enable GitHub merge queue and skip jobs that cannot be affected by
the PR's diff.

**In scope.**

- Add `merge_group:` trigger alongside the existing `push:` / `pull_request:`
  triggers in `.github/workflows/ci.yml` and any other PR-blocking workflow.
- Add `paths:` / `paths-ignore:` filters or use
  `dorny/paths-filter@<sha>` to skip:
  - The analysis job when nothing under `apps/analysis/**`,
    `requirements*.txt`, or `.github/workflows/ci.yml` changed.
  - The docker-compose job when nothing under `docker-compose.ci.yml`,
    `apps/**`, or `.github/workflows/ci.yml` changed.
- Make all skipped jobs report a successful "skipped" status check so branch
  protection still passes (use `if:` + a no-op final step, not a missing job).

**Out of scope.**

- Changing branch-protection rules (must be done by an admin in repo
  settings, not in code).
- Skipping `validate`, security audits, CodeQL, or gitleaks. Those run
  unconditionally.

**Validation.**

- Push a docs-only commit on the PR branch; confirm the analysis and
  docker-compose jobs are skipped and the required checks still go green.
- Push an `apps/analysis/**` commit; confirm the analysis job runs again.

**Stop condition.** Both scenarios above behave as expected on the PR's own
runs.

---

## 3. How to prompt the next session

Open a fresh Copilot Task Agent / Claude Code session **per slice**. Use the
template below verbatim, swapping the slice letter. The agent will then read
this file (it is committed in the repo) for full context.

```
Implement PR (<a|b|c|d>) of the CI optimization series.

Authoritative plan: docs/playbooks/ci-optimization-series.md
Read that file end-to-end before touching anything.

Rules:
- Stay strictly within "In scope" for the slice. If you would touch anything
  in "Out of scope", stop and surface it in the PR description instead.
- Follow the "Shared rules for every PR in this series" section.
- Run the slice's "Validation" commands locally before opening the PR.
- Stop at the slice's "Stop condition" — do not start the next slice.

When done:
1. Open one PR with the slice letter in the title, e.g.
   "ci(a): turbo orchestration + dependency caches + per-job timeouts".
2. In the PR body, include before/after wall-clock timings and a short
   "what I deliberately did not do" list.
3. Update WORKLOG.md per AGENTS.md §Handoff.
```

---

## 4. Order of operations and dependencies

- (a) and (c) are independent. Either can land first.
- (b) is easier to measure after (a) lands (caches already in place).
- (d) should land last, because path filters are easier to validate once the
  job set is stable.

Recommended order: **a → c → b → d**.

---

## 5. Cross-links

- `.github/copilot-instructions.md` — non-negotiable repo rules
- `AGENTS.md` — universal agent playbook (PR caps, sensitive paths,
  validation, handoff)
- `CLAUDE.md` — architecture + commands + sensitive paths
- `docs/playbooks/repo-aware-ai-coding-playbook.md` — operating model
- `docs/playbooks/post-pr-163-followups.md` — precedent for this kind of
  handoff doc
