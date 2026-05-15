<!-- PhenoSage PR template. Keep PRs small and bounded. -->

## Outcome

<!-- One sentence: what user-visible or system-visible change does this make? -->

## Scope

- [ ] Single concern; no drive-by refactors
- [ ] Affected paths listed below

Affected paths:

```
<paths>
```

## Validation

Paste the output (or summary) of:

- [ ] `pnpm run validate`
- [ ] `pnpm turbo run type-check lint test`
- [ ] `pnpm turbo run build`
- [ ] `pnpm run security:routes`
- [ ] (If `apps/analysis` changed) `ruff check . && mypy app/ && pytest --cov=app`

## Test evidence

<!-- Paste test output, new test names added, coverage delta, or a link
     to a Playwright preview run. -->

## Observability impact

<!-- Does this change add/remove log lines? Introduce a new Sentry event
     category? Change an SLI? If "no impact", say so. -->

## Architecture & Forbidden Changes

Confirm none of the following were introduced (see `.github/copilot-instructions.md`):

- [ ] No browser code calls the analysis service or Supabase service-role APIs directly
- [ ] No server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANALYSIS_SERVICE_*`) leaked to client modules or `NEXT_PUBLIC_*`
- [ ] No client component imports from `apps/web/src/lib/server/**`
- [ ] No `middleware.ts` added to act as a backend proxy
- [ ] No public Supabase Storage bucket for user content
- [ ] No edits to previously-committed `supabase/migrations/**` files
- [ ] No SQLite, second database, or new microservice introduced

## Affected Boundaries

Tick all that apply:

- [ ] Shared types (`packages/shared`)
- [ ] Supabase migration (`supabase/migrations/**`)
- [ ] Web Route Handler (`apps/web/src/app/api/**`)
- [ ] Server-only module (`apps/web/src/lib/server/**`)
- [ ] Analysis service contract (`apps/analysis/app/models/**`)
- [ ] Env vars / `.env.example`

If any boundary above is ticked, confirm contract symmetry across all sides
in the same PR (see `docs/playbooks/contract-safe-change-playbook.md`).

## Rollback

How do we revert this safely?

- [ ] Pure `git revert` is sufficient
- [ ] Requires migration rollback (describe below)
- [ ] Requires env var rollback (describe below)

```
<rollback notes>
```

## Follow-ups

<!-- List items that are intentionally deferred from this PR.
     The track-followups workflow will automatically open a GitHub issue
     for each bullet here when this PR is merged.
     Format: one bullet per deferred item, starting with "- ". -->

<!-- Example:
- Add X to handle edge case Y
- Write integration test for Z path
-->
