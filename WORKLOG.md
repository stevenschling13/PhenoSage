# WORKLOG

Handoff log between sessions. Keep entries short. Newest at top.

---

## 2026-05-08 — chat+cron+comparison integration scaffolding (Codex)

**Landed on feature branch**

- Added authenticated chat grow-context hydration and server-side persistence for `chat_threads`/`chat_messages` in `apps/web/src/app/api/chat/route.ts`, including generation lifecycle states (`started/succeeded/failed/inconclusive`) stored in message metadata.
- Implemented internal daily-summary cron pipeline skeleton in `apps/web/src/app/api/internal/cron/daily-summary/route.ts`: loads active grows, aggregates events/findings, generates AI summary, persists summary records to `grow_events`, and records notification enqueue placeholder events.
- Implemented end-to-end image comparison service in `apps/analysis/app/services/image_comparison.py` with storage fetch + vision call + structured result contract.
- Added shared/analysis types for comparison and chat generation status contracts in `packages/shared/src/types.ts` and `apps/analysis/app/models/analysis.py`.
- Expanded integration-style tests for chat route, cron route, and image comparison service happy-path/auth paths/failure-safe behavior.

**In-flight**

- Branch: current working branch (PR not opened yet in this session).

**Dead ends**

- No durable notifications table exists in current schema; cron currently persists a notification-queued placeholder as `grow_events.note` for observability until a dedicated queue table lands.

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
