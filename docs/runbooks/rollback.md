# Rollback — PhenoSage

Reversing a production change. Different stacks have different mechanics; this
file is the single source of truth.

## Web (Vercel)

Vercel preserves every deployment. Rolling back is a promotion, not a redeploy.

```bash
vercel ls                      # find the previous healthy deployment URL
vercel promote <deployment-url>
```

Then:

```bash
curl -fsS https://<prod-url>/api/health
curl -fsS https://<prod-url>/api/ready | jq .status
```

## Analysis (Railway)

Railway dashboard → **Deployments** → ⋮ on a previous successful build → **Redeploy**.
CLI rollback is not stable as of this writing.

After rollback:

```bash
curl -fsS $ANALYSIS_SERVICE_URL/health
curl -fsS $ANALYSIS_SERVICE_URL/ready | jq .status
```

## Supabase migration

Migrations are expected to be additive. To reverse one:

1. Find the migration file in `supabase/migrations/`.
2. Write a new migration that undoes the DDL (drop column, drop index, etc.).
   **Never edit the original migration.**
3. `supabase db push` the new migration through the usual CI/preview flow.

If the migration already caused data loss: restore from Supabase's daily
automatic backup (Pro plan) via the Supabase dashboard.

## Env var rollback

Vercel:

```bash
vercel env rm <NAME> production
vercel env add <NAME> production  # re-enter previous value
```

Railway:

```bash
railway variables --set <NAME>=<previous-value>
```

## Combined rollback (code + migration)

If a change required both a code change and a migration:

1. Code revert first (Vercel/Railway).
2. Migration reverse next (Supabase).
3. Verify `/api/ready` and `/ready` return 200.

Reversing code before the migration is usually safe because the additive
migration leaves the old code shape compatible. If the migration dropped
a column the old code needs, you'll have to restore data from backup.

## Who to notify

- SEV-1 or data loss: open a GitHub issue with label `sev:1` immediately.
- SEV-2/3: note in `WORKLOG.md` with the commit SHA that was rolled back to.
