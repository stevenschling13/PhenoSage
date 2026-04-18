# On-Call — PhenoSage

Solo-maintainer reality check: there's no rotation. If PhenoSage breaks, it
breaks. This file exists so future-you (or a helper) can act fast.

## Dashboards

- **Vercel web**: https://vercel.com/stevenschling13/phenosage
- **Railway analysis**: https://railway.com/project/<project-id>
- **Supabase**: https://supabase.com/dashboard/project/<project-ref>
- **GitHub Actions**: https://github.com/stevenschling13/PhenoSage/actions
- **Sentry** (if provisioned): https://sentry.io/organizations/<org>/projects/phenosage

## Daily 60-second check

1. `curl -fsS $APP_URL/api/health` — expect `{"status":"ok"}`.
2. `curl -fsS $APP_URL/api/ready` — expect 200.
3. `curl -fsS $ANALYSIS_SERVICE_URL/ready` — expect 200.
4. GitHub Actions: last 5 runs on `main` are green.
5. Dependabot: no open PRs older than 7 days.

If any step is red, open `WORKLOG.md` and log the start of an incident.

## Weekly 10-minute check

1. Run `pnpm run security:audit`.
2. Review Supabase → Advisors (or `mcp__supabase__get_advisors`).
3. Inspect bundle size trend: compare last 3 `test-web` run summaries.
4. Review open issues with `sev:3` or higher.

## Monthly

1. Rotate `ANALYSIS_SERVICE_API_KEY` (Vercel + Railway).
2. Rotate `CRON_SECRET` (Vercel project settings).
3. Test rollback end-to-end on a preview deploy.
4. Check `docs/roadmap.md` against reality; prune finished items.

## Who to contact

- Supabase support: https://supabase.com/support
- Vercel support: https://vercel.com/help
- Railway support: Railway dashboard → Help
- OpenAI: https://help.openai.com
