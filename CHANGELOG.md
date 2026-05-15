# Changelog

All notable changes to PhenoSage are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows
[SemVer](https://semver.org/) once we cut 1.0; until then, changes are grouped
by date under `## [Unreleased]`.

## [Unreleased] — 2026-05-15 notifications M2 + post-wave drift cleanup

### Added

- **Notifications (Milestone 2 — server side)** (#156): new `notifications`
  table with `notification_kind` / `notification_priority` enums, RLS
  (self-only SELECT, immutable-columns trigger on UPDATE, service-role-only
  INSERT), and a partial `UNIQUE (user_id, kind, occurred_on)` scoped to
  `daily_summary` (migrations `014_notifications.sql` +
  `015_fix_notifications_unique_index.sql`). `apps/web/src/lib/server/daily-digest.ts`
  fans out per-user snapshots over `plant_findings` / `plant_images` /
  `plant_observations` / `grow_tasks`, calls Gemini through the existing
  `getAIClient()`, and writes one notification per user per day via
  `/api/internal/cron/daily-summary`. The cron is gated by `CRON_SECRET`,
  uses `upsert(ignoreDuplicates: true)`, runs in batches of 5 with a
  45 s time budget, and per-user failures are logged but do not abort the
  run. Dashboard badge / panel UI ships in a follow-up PR.
- **Shared types** (#152): `GrowTask`, `TaskPriority`, `TaskStatus`, and
  `FindingSource` (`'ai' | 'user_reported'`) added to
  `packages/shared/src/types.ts` so the chat tools and migration 008/010
  contracts are now type-checked end-to-end.
- **Route security audit** (#152): `scripts/check-route-security.mjs` now
  detects re-exported HTTP handlers (`export { GET } from ...`); previously
  `api/healthz` slipped through. `/api/healthz` is registered as an
  intentional public route and pinned by a new contract test.
- **Migration 012_function_hardening** (#154) — closes Supabase advisor
  function-search-path warnings.
- **Migration 013_pgvector_extensions_schema** (#155) — moves the
  `vector` extension from `public` to a dedicated `extensions` schema
  (idiomatic Supabase pattern; keeps extension types/operators out of the
  PostgREST surface). Includes auth-toggle documentation update.

### Fixed

- **Migration 003** (#153): qualified `storage.objects.name` inside the
  `plant-images: owner upload` storage policy to resolve a `42702`
  ambiguous-column error that was blocking fresh project bring-up via
  `supabase db push`. Production was already applied with the corrected
  SQL via MCP, so the repo edit syncs the file back to what the remote
  actually executed.
- **Railway start command** (#157): `apps/analysis/railway.toml` start
  command is now wrapped in a shell so `$PORT` expands at runtime rather
  than being passed to uvicorn as a literal string.

---

## [Unreleased] — 2026-05-15 agentic chat + grow lifecycle wave

### Added

- **Chat agentic tools** (`apps/web/src/lib/server/chat-tools.ts`): the
  assistant gained a full write+read tool surface — `create_grow`,
  `create_plants`, `create_grow_task` (#139); `update_grow`,
  `update_plant` (#140); `record_image_finding` with user-source RLS
  (#141); `get_plant_timeline`, `trigger_plant_analysis` (#142);
  fuzzy `find_grow`, `find_plant` entity resolvers (#143);
  `compare_plants`, `get_grow_summary` plus a refreshed cannabis-
  cultivator system prompt (#144). Earlier waves added
  `log_grow_event` / `log_plant_observation` (#132),
  `mark_finding_resolved` / `update_grow_stage` (#133), and the
  auto-action pipeline that spawns `grow_tasks` from chat (#134).
- **Grow lifecycle**: bulk plant create with auto-numbered names
  (#138); detail page, archive flow, and migration `011_grows_integrity`
  (partial UNIQUE on `(owner_id, lower(name)) WHERE NOT is_archived`)
  (#147); edit, stage-advance, and hard-delete actions on the grow
  detail page (#150).
- **Database migrations** beyond the 001-002 baseline: `003`
  production index pass, `004` `plant_analyses`, `005` `analysis_jobs`,
  `006` `chat_attachments`, `007` `plant_findings.resolved_at`, `008`
  `grow_tasks`, `009` chat/findings indexes, `010` user-source findings,
  `011` grows integrity (above).
- **Ops**: one-click Supabase migration apply via `workflow_dispatch`
  in `db-migrations.yml` (#148); project-scoped Supabase MCP config in
  `.mcp.json` (#149).

### Changed

- `useActionRecovery` hook extracted so server-action redirect-bug
  pattern (try/catch + `isNextFrameworkError` re-throw + return
  `redirectTo` + client `router.push`) is reusable across forms (#145).
- Chat copy + system prompt rewritten for serious cannabis cultivators
  (#119, #144); chat threading + in-app grow picker (#120).

### Fixed

- `createGrowAction` redirect-from-await bug — landings now go to
  `/grows` instead of throwing a framework error (#145).
- Grow + settings server actions hardened against unhandled exceptions
  (#135).

### Security

- Analysis service `storage_path` validated to prevent SSRF (CodeQL
  alert #164) (#146).
- `record_image_finding` uses a dedicated `source = 'user'` RLS path
  so chat-recorded findings don't impersonate AI-generated ones (#141).

---

## [Released] — 2026-04-18 production-hardening pass

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

- Engines bumped: Node `>=20`, pnpm `>=9`.
- `apps/web/tsconfig.json` and `packages/shared/tsconfig.json` extend
  `tsconfig.base.json`.
- `next.config.mjs` headers now include CSP, COOP, CORP.

### Removed

- `supabase/migrations/20260418184704_new-migration.sql` (empty stub).

### Security

- All API routes under `apps/web/src/app/api/**` are now audited by
  `check-route-security.mjs`. `/api/internal/**` routes must guard with a
  cron secret; all other routes must use `@/lib/server/auth`.
