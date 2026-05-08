# WORKLOG

Handoff log between sessions. Keep entries short. Newest at top.

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
- `pnpm audit` still flags 2 moderate advisories per Dependabot.

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
