# WORKLOG

Handoff log between sessions. Keep entries short. Newest at top.

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
