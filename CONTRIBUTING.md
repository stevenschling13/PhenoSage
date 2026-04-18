# Contributing to PhenoSage

Thanks for considering a contribution. This guide covers the workflow.

## Workflow

1. **Open an issue first** for anything non-trivial. Bug reports and feature
   requests have templates in [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE).
2. **Fork or branch** from `main`. Branch names: `feat/...`, `fix/...`,
   `docs/...`, `chore/...`, `refactor/...`.
3. **Open a Pull Request** against `main`. Fill in the PR template.
4. **CI must be green**: validate, web, analysis, shared, CodeQL, Gitleaks.
5. **Get a review.** All PRs require at least one approval (enforced).
6. **Squash-merge** is the only allowed merge strategy. The branch is deleted
   automatically.

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(web): add timeline pagination
fix(analysis): clamp severity to enum
docs(readme): update local setup
chore(deps): bump next to 14.2.5
```

Commit messages must be **signed** (`git commit -S`). If you don't have a
signing key, set one up with [GitHub's SSH commit signing](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification).

## Local development

```bash
pnpm install
cp .env.example .env.local            # then fill in values
pnpm dev                              # web app on :3000

# Analysis service in another terminal
cd apps/analysis
python -m venv .venv && . .venv/Scripts/activate
pip install -r requirements.txt
uvicorn app.main:app --reload          # :8000
```

## Required local checks before opening a PR

```bash
pnpm validate          # env contract + route boundaries + imports
pnpm type-check
pnpm lint
pnpm build             # web build with stub env values

cd apps/analysis
ruff check .
mypy app/
pytest -q
```

## Architecture rules (enforced by `pnpm validate`)

- **Vercel is the only public origin.** The browser must never call Railway or
  use the Supabase service role key.
- Server-only environment variables (those without `NEXT_PUBLIC_` prefix) must
  never be imported from a client component or referenced in a non-`route.ts`
  file under `apps/web/src/app/`.
- The analysis service must be reached only via `lib/server/analysis-proxy.ts`.

## Adding a Supabase migration

```bash
npx supabase migration new my-change
# edit supabase/migrations/<timestamp>_my-change.sql
npx supabase db push    # requires SUPABASE_ACCESS_TOKEN
```

Migrations run inside a transaction. Keep them idempotent where possible
(`create table if not exists`, etc.). Test against a Supabase branch first
when the change is risky.

## Post-deploy verification

After a deploy to production, the smoke test runs automatically. To run it
locally against the prod URL:

```bash
pwsh scripts/smoke-test-prod.ps1
```

It exits non-zero if any endpoint, security header, or secret-leak check fails.
