---
name: phenosage-ops-commander
description: Daily operations sweep for PhenoSage — CI health, deploy state, stale PRs, dependency staleness. Use at the start of a working session for a 5-minute "what do I need to know?" briefing.
---

# phenosage-ops-commander

## Briefing checklist

1. **CI**: last 10 workflow runs on `main`. Flag any non-success.
2. **Deploys**: `vercel ls --yes` (most recent 3), `railway status` or dashboard screenshot.
3. **Supabase**: run `mcp__supabase__get_advisors` (if available). No new advisors = green.
4. **Dependabot**: count open PRs; flag any blocked by CI.
5. **Security alerts**: GitHub dependabot advisories; gitleaks results on `main`.
6. **Docs**: check `WORKLOG.md` for in-progress threads to resume.

## Output format

```
PhenoSage Ops — <date>
CI (main, last 10):      <n> green / <n> failed
Vercel web:              <state> @ <commit-sha>
Railway analysis:        <state> @ <commit-sha>
Supabase advisors:       <n> (0 = good)
Open dependabot PRs:     <n>
Stale PRs (>7d):         <n>
Action items:            <bullet list>
```

## Red lines

- `> 0` failed workflow runs on `main` → triage before any new feature work.
- Dependency audit (`pnpm audit --prod --audit-level=high`) reports a finding → patch in its own PR.
- Any Supabase advisor at level ERROR → stop feature work.
