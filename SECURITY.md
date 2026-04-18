# Security Policy

## Supported versions

Only the latest commit on `main` (deployed to production) is supported.
There are no LTS branches.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately via GitHub's [private vulnerability reporting](https://github.com/stevenschling13/PhenoSage/security/advisories/new).

You should receive an acknowledgement within **3 business days** and a
remediation plan within **10 business days** for a confirmed vulnerability.

## Scope

In scope:

- The deployed web app at `https://pheno-sage-web.vercel.app`
- The analysis service hosted on Railway (private origin, must not be publicly callable)
- Database / RLS policies in `supabase/migrations/`
- API routes under `apps/web/src/app/api/`
- Cron endpoints under `apps/web/src/app/api/internal/`
- Secrets handling, CORS, CSP, auth flows

Out of scope:

- Vulnerabilities in third-party providers (Vercel, Supabase, Railway, OpenAI) — report to the provider
- Self-XSS, social engineering, physical attacks
- Issues requiring an already-compromised account or device

## Disclosure policy

We follow **coordinated disclosure**. Public disclosure happens after a fix
ships to production and at most 90 days after the report, whichever comes first.

## Security controls in this repo

- Branch protection on `main`: required PR review, signed commits, linear history, status checks must pass
- CodeQL analysis (JavaScript/TypeScript and Python) on every PR and weekly
- Gitleaks secret scan on every PR
- GitHub native secret scanning + **push protection** enabled
- OpenSSF Scorecard runs weekly; results published to the repo Security tab
- Dependabot version + security updates for `npm`, `pip`, and `github-actions`
- Server-only environment variables never exposed to the client (verified by `pnpm run check:env`)
- Supabase RLS on every user-data table; service role key only used server-side
