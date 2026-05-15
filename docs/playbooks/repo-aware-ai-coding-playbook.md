# Repo-Aware AI Coding Playbook

How humans and AI agents collaborate on this repo without breaking it.

## Principles

1. **Bounded changes.** One concern per PR. If a task naturally spans
   multiple concerns, break it into a sequence of PRs and land them in order.
2. **Executable guardrails over prose.** If a rule matters, write a script
   in `scripts/check-*.mjs` that fails CI when it's violated.
3. **Server/client separation is sacred.** See `.github/copilot-instructions.md`.
4. **Contract symmetry.** See `docs/playbooks/contract-safe-change-playbook.md`.
5. **Append-only history for migrations.** Never edit a committed migration.
6. **Minimal placeholders, real scaffolding.** Stubs must compile, type-check,
   and explicitly mark `// TODO:` for the real work.

## Task lifecycle

### 1. Frame the task

Before writing code, the agent (or human) must answer:

- What boundary does this touch? (web Route Handler, server lib, shared type, migration, analysis service)
- What's the contract impact? (none / additive / breaking)
- What's the validation plan? (which `pnpm run` and `pytest` commands)
- What's the rollback story?

### 1.5 Brief the next agent precisely

When handing work to another agent, give it a prompt with:

- **One target outcome** only (one roadmap box / one bug / one contract edit)
- **Boundary callout** (web, analysis, migration, shared contract, route)
- **Explicit out-of-scope list** so it does not widen the PR
- **Validation commands** it must run before finishing
- **Stop condition** ("if this becomes a breaking contract or exceeds a bounded
  PR, stop and surface it")

Good handoff prompts name the exact file paths when known and point the next
agent at `WORKLOG.md` plus the relevant playbook. Broad prompts like "finish
Tier 3" or "wrap up Milestone 2" are usually counterproductive because they
encourage scope creep instead of one bounded, reviewable change.

### 2. Make the change

- Edit the smallest set of files that fully solves the task.
- Stay inside the relevant `applyTo:` scope from `.github/instructions/`.
- If you need to touch a forbidden area, **stop and surface it** — don't work around the rule.

### 3. Validate locally

```bash
pnpm run validate     # repo-level guardrails (env, route boundaries, imports)
pnpm run type-check
pnpm run lint
pnpm run build
```

For analysis-service changes:

```bash
cd apps/analysis
ruff check . && mypy app/ && pytest
```

### 4. Open the PR

- Fill **every** section of `.github/PULL_REQUEST_TEMPLATE.md`.
- Tick the "Forbidden Changes" checklist honestly.
- Paste validator output (or a one-line summary).

### 5. Review

Reviewers check:

- The PR matches its scope.
- Contract symmetry holds across all sides touched.
- No secrets crossed the server/client boundary.
- Validators pass in CI.
- Rollback plan is credible.

## What AI agents should refuse to do

- Disable or weaken a `scripts/check-*.mjs` validator to "make CI green".
- Move a server-only import into a client component.
- Add a `NEXT_PUBLIC_*` env var that holds a backend secret.
- Edit a committed migration in place.
- Add unrelated refactors to an in-flight PR.

## What AI agents should proactively do

- Add a new validator when introducing a new architectural rule.
- Update the matching `.env.example` and the env contract list when adding a new env var.
- Update `packages/shared` and all consumers in the same PR when changing a contract.
- Add a SQL comment naming the writer (user vs service role) on every new table.
