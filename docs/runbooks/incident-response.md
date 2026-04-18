# Incident Response — PhenoSage

On-call playbook for production incidents.

## Triage in 5 minutes

1. **Scope**: is the web app, the analysis service, Supabase, or a third-party
   (OpenAI, Vercel, Railway) affected? Check:
   - `https://<prod-url>/api/health` and `/api/ready` — web
   - `https://<analysis-url>/health` and `/ready` — analysis
   - https://status.supabase.com, https://www.vercel-status.com,
     https://status.railway.com, https://status.openai.com
2. **Severity**:
   - **SEV-1** — full web outage, auth broken, data loss risk.
   - **SEV-2** — analysis service down; web degrades but runs.
   - **SEV-3** — one route / one feature broken.
   - **SEV-4** — cosmetic / polish.
3. **Ownership**: post a heads-up in the incident channel with severity and
   the current hypothesis.

## Web outage (Vercel)

- `vercel ls` → note the active deployment.
- Inspect `vercel logs <deployment-url> --follow`.
- If a recent deploy is the cause: `vercel promote <previous-healthy-url>`.
- Confirm `/api/health` returns 200 against the promoted URL.

## Analysis outage (Railway)

- Railway dashboard → Deployments → check restart loop or OOM.
- `railway logs --service phenosage-analysis -n 500`.
- If the latest deploy is bad: redeploy previous build from the dashboard.
- If config missing: `/ready` will tell you exactly which env var is absent.

## Supabase incident

- RLS denial floods logs → check `supabase db log` and `auth.audit_log_entries`.
- Migration failure → DO NOT attempt to roll forward. Pin the web app's
  `NEXT_PUBLIC_SUPABASE_URL` to the previous project if one exists; otherwise
  wait for Supabase support.
- Storage bucket unreachable → check `002_storage_buckets.sql` is the only
  source of truth for bucket policies.

## OpenAI quota / outage

- Analysis returns 5xx cascading from OpenAI → the proxy logs the upstream
  status. The web UI should show a friendly "analysis unavailable" message —
  confirm with `curl -s $APP_URL/api/plants/<id>/analysis/latest`.
- Switch model or lower concurrency only with explicit approval.

## After the incident

1. Fill out `docs/runbooks/incident-postmortem-template.md` (create this file
   when first needed) within 48 hours.
2. Add a `test-analysis` or `test-web` regression test covering the failure
   mode. If you can't — document why.
