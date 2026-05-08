# WORKLOG

Handoff log between sessions. Keep entries short. Newest at top.

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
