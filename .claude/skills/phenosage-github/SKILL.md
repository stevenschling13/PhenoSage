---
name: phenosage-github
description: PR and issue automation for stevenschling13/phenosage. Use for triaging CI failures, managing dependabot PRs, and opening scoped issues.
---

# phenosage-github

Scope: `stevenschling13/phenosage` only. Use the `mcp__github__*` tools.

## Daily triage

- `mcp__github__list_pull_requests` (state=open) — review outstanding PRs.
- `mcp__github__search_issues` for `is:open label:dependencies` — dependabot queue.
- `.github/workflows/dependabot-auto-merge.yml` handles patch/minor updates; only intervene for majors.

## CI failure triage

1. `mcp__github__list_commits` on `main` to find the last green commit.
2. Fetch run details; identify the failing job (`test-web`, `test-analysis`, `test-shared`).
3. Reproduce locally: `pnpm turbo run <task>` or `pytest` in `apps/analysis`.
4. Open a branch named `fix/<scope>-<short-slug>` — never push straight to `main`.

## Opening issues

Use `mcp__github__issue_write` with:

- Labels: one of `scope:web`, `scope:analysis`, `scope:shared`, `scope:infra`, `scope:docs`.
- Severity: `sev:1` (outage) … `sev:4` (polish).
- Body must include: reproduction steps, observed vs. expected, link to the failing CI run if any.

## Don'ts

- Do NOT force-push to `main`.
- Do NOT merge PRs without the `ci-status` job passing.
- Do NOT comment on PRs unless action is required — keep noise low.
