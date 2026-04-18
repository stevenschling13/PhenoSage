# AGENTS.md

Universal playbook for any automated agent working on PhenoSage — Claude Code,
Copilot, Codex, custom MCP runners. Anything in this file is non-negotiable.

## Read order (every new session)

1. `CLAUDE.md` — architecture + ports + commands (2 minutes).
2. `.github/copilot-instructions.md` — load-bearing forbidden changes.
3. `WORKLOG.md` — what the previous session was doing.
4. Only then, read the task.

## PR size caps

- **Files**: ≤ 30
- **Lines changed**: ≤ 1,500
- **Single file growth**: ≤ 500 lines

Exceptions require the `guardian:approved` label from a human maintainer. `scripts/pr-guardian.mjs` enforces this advisorily in CI.

## Sensitive paths — always flag before editing

- `supabase/migrations/**`
- `packages/shared/src/**`
- `apps/web/src/lib/server/**`
- `apps/web/src/lib/env.ts`
- `apps/web/next.config.mjs`
- `apps/web/src/app/api/**/route.ts`
- `apps/analysis/app/routers/**`
- `apps/analysis/app/models/**`
- `.github/workflows/**`
- `.claude/**`

For any edit to the above: spawn the `contract-guardian` agent, or state in your PR body why that review is not needed.

## Validation — before any commit

Run, in order, and stop on first failure:

```bash
pnpm run validate
pnpm turbo run type-check lint test
pnpm run security:routes
```

If `apps/analysis/**` changed:

```bash
cd apps/analysis && ruff check . && mypy app/ && pytest --cov=app
```

## Forbidden actions

- `git push --force` to any branch an open PR is tracking.
- `git push --force` to `main` under any circumstance.
- `--no-verify` / `--no-gpg-sign` on any commit.
- `supabase db reset` against a linked remote.
- Editing a migration file already present on `main`.
- Disabling a security header in `next.config.mjs` without replacing it.
- Adding an `apps/web/middleware.ts` file.
- Bypassing the route-security audit with a blanket allow.

## Commit style

- Conventional Commits (commitlint-enforced).
- Scope uses kebab-case and names the primary area: `feat(web): …`, `fix(analysis): …`, `ci: …`, `chore(claude): …`.
- Body lines ≤ 200 chars (commitlint rule).

## Handoff

When closing a session, update `WORKLOG.md` with:

1. What landed (with commit SHA).
2. What's in-flight (branch name + PR link if any).
3. Any dead ends — so the next agent doesn't repeat them.
