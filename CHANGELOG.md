# Changelog

All notable changes to PhenoSage are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows
[SemVer](https://semver.org/) once we cut 1.0; until then, changes are grouped
by date under `## [Unreleased]`.

## [Unreleased] — 2026-04-18 production-hardening pass

### Added

- **Tooling**: Turborepo task graph, `tsconfig.base.json` with strict flags
  (`exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`),
  Prettier config, Husky v9 hooks (pre-commit lint-staged, commit-msg commitlint),
  conventional commit config.
- **Testing**: Vitest for `apps/web` (7 unit tests) and `packages/shared`
  (5 contract tests); Playwright config + smoke spec for future golden-path E2E;
  `pytest-cov` wired for `apps/analysis`.
- **CI**: Parallel `test-web`, `test-shared`, `test-analysis` jobs; concurrency
  group with cancel-in-progress; `step-security/harden-runner@v2` on every job;
  bundle-size summary; aggregate `ci-status` gate job.
- **Observability**: `/api/ready` on web (503 on config gap), `/ready` on
  analysis (same semantics), `commit` + `env` echoed from `/health`,
  `useServiceHealth()` hook polling every 15s, Sentry + OTel bootstrap in
  analysis (no-op without DSN/endpoint).
- **Security**: Content-Security-Policy with strict `default-src`, COOP,
  same-origin CORP, HSTS preload; `src/lib/env.ts` server-env validator;
  `src/lib/server/rate-limit.ts` sliding-window limiter (edge-safe);
  `scripts/check-route-security.mjs` auditing auth posture on every Route
  Handler; `scripts/security-audit.mjs` aggregate pre-deploy check.
- **AI workspace**: `.claude/` with 10 PhenoSage-themed skills, sensitive-path
  advisory hook, session-stop validation hook, `contract-guardian` subagent,
  and `/phenosage-ship-check` / `/phenosage-morning-ops` slash commands.
- **Docs**: `CLAUDE.md` (AI entry point), `AGENTS.md` (universal playbook),
  `WORKLOG.md` (session handoff), `CHANGELOG.md` (this file),
  `docs/runbooks/` (incident, rollback, on-call).
- **PR quality**: `scripts/pr-guardian.mjs` (file/line caps);
  PR template gains Test evidence + Observability impact sections.

### Changed

- Engines bumped: Node `>=22`, pnpm `>=9`.
- `apps/web/tsconfig.json` and `packages/shared/tsconfig.json` extend
  `tsconfig.base.json`.
- `next.config.mjs` headers now include CSP, COOP, CORP.

### Removed

- `supabase/migrations/20260418184704_new-migration.sql` (empty stub).

### Security

- All API routes under `apps/web/src/app/api/**` are now audited by
  `check-route-security.mjs`. `/api/internal/**` routes must guard with a
  cron secret; all other routes must use `@/lib/server/auth`.
