---
name: phenosage-supabase-ops
description: "Inspect and manage the PhenoSage Supabase project — RLS audits, seed data, pgvector health, and migration diffs. Use when schema drifts, RLS is suspected broken, or pgvector queries are slow."
metadata:
  author: stevenschling13
  version: "1.0.0"
---

# PhenoSage Supabase Ops

Everything an agent needs to operate the PhenoSage Supabase project, tailored to the actual schema, client code, MCP connection, and conventions in this repo.

---

## 1. MCP Connection

**Project ref:** `yjemotnclrnlxgcfntaf`

**`.mcp.json` (repo root):**
```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=yjemotnclrnlxgcfntaf"
    }
  }
}
```

**Troubleshoot:**
1. `curl -so /dev/null -w "%{http_code}" https://mcp.supabase.com/mcp` → `401` means server is up.
2. Check `.mcp.json` exists and has the correct `project_ref`.
3. If tools aren't visible: trigger the MCP OAuth 2.1 flow in the agent, complete it in the browser, reload the session.

**Dashboard:** `https://supabase.com/dashboard/project/yjemotnclrnlxgcfntaf`

---

## 2. Environment Variables

| Variable | Location | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | PostgREST / Auth base URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Anon role JWT, ships to browser |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | Bypasses RLS; never expose to client |

Validated at startup by `apps/web/src/lib/server/env.ts` — `NEXT_PUBLIC_SUPABASE_URL` must match `^https://[^/]+\.supabase\.(co|in)(/|$)`.

**Security rule (absolute):** `SUPABASE_SERVICE_ROLE_KEY` must never appear in a `NEXT_PUBLIC_*` var, a client component, or `apps/web/src/lib/supabase-client.ts`. Any `NEXT_PUBLIC_*` var is shipped to the browser bundle.

---

## 3. Supabase Clients — Where They Live

### Browser client (`apps/web/src/lib/supabase-client.ts`)
```ts
// "use client" — uses NEXT_PUBLIC_* only
createBrowserClient(url, anonKey)
```
Import as `createSupabaseBrowserClient()`. Never import in server code.

### Server client (cookie-scoped, per-request) — `apps/web/src/lib/server/auth.ts`
```ts
import "server-only";
// Uses @supabase/ssr createServerClient + next/headers cookies()
// Respects the authenticated user's session. RLS applies as auth.uid().
createSupabaseServerClient()   // throws AuthConfigError if env missing
getServerSession()             // → Session | null
getServerUser()                // → User | null
tryGetServerUser()             // → User | null, never throws
```

### Service-role client (bypasses RLS) — `apps/web/src/lib/server/db.ts`
```ts
import "server-only";
// Uses SUPABASE_SERVICE_ROLE_KEY. No session persistence.
getDbClient()   // → SupabaseClient
```
Use this for cron writes, AI analysis result writes, notification inserts — any server-initiated write where no user session is present.

### Storage client — `apps/web/src/lib/server/storage.ts`
```ts
import "server-only";
// Also uses service role key.
getStorageClient()   // → SupabaseStorageClient
```

---

## 4. Full Database Schema

> All tables are in the `public` schema with RLS enabled.

### Enums
| Type | Values |
|---|---|
| `grow_stage` | `germination`, `seedling`, `vegetative`, `pre_flower`, `flower`, `late_flower`, `harvest`, `dry_cure` |
| `grow_medium` | `soil`, `coco`, `hydro`, `aero`, `living_soil`, `other` |
| `light_type` | `hps`, `cmh`, `led`, `t5`, `sun`, `mixed`, `other` |
| `grow_role` | `owner`, `collaborator`, `viewer` |
| `image_source` | `upload`, `camera` |
| `finding_category` | `nutrient_deficiency`, `nutrient_toxicity`, `pest`, `disease`, `environmental`, `training`, `general`, `positive` |
| `finding_severity` | `info`, `low`, `medium`, `high`, `critical` |
| `event_type` | `water`, `feed`, `top`, `fim`, `lst`, `defoliate`, `transplant`, `ipm`, `harvest`, `observation`, `note`, `other` |
| `message_role` | `user`, `assistant`, `system` |
| `task_priority` | `low`, `medium`, `high`, `urgent` |
| `task_status` | `open`, `in_progress`, `done`, `dismissed` |
| `notification_kind` | `daily_summary`, `finding_alert`, `collaborator_invite`, `system` |
| `notification_priority` | `info`, `warning`, `critical` |

### Tables

#### `profiles`
Auto-created on signup via `trg_on_auth_user_created` → `handle_new_user()` (SECURITY DEFINER).
```
id uuid PK → auth.users(id) ON DELETE CASCADE
display_name text | avatar_url text | created_at | updated_at
```
RLS: `owner read` (select), `owner update`. **No service-role insert needed** — trigger handles it.

#### `grows`
```
id uuid PK | owner_id uuid → auth.users | name text | description text
stage grow_stage | medium grow_medium | light_type light_type
target_harvest_date date | start_date date | is_archived bool | created_at | updated_at
```
RLS: `member read` (owner OR grow_members row), `owner write` (all). Trigger: `trg_grows_updated_at`.

#### `grow_members`
```
grow_id uuid → grows | user_id uuid → auth.users | role grow_role | created_at
PK (grow_id, user_id)
```
RLS: `grow owner manage` (all), `self read` (select).
⚠️ `grows.owner_id` is also auto-added to `grow_members` with role `owner` via the `grow_insert_owner_member` trigger (migration 011, SECURITY DEFINER, no direct RPC access).

#### `plants`
```
id uuid PK | grow_id uuid → grows | name text | strain text | batch_label text
notes text | is_archived bool | created_at | updated_at
```
RLS: `grow member read`, `grow owner write`. GIN trigram indexes on `name`, `strain`, `batch_label` (non-archived only, migration 019).

#### `plant_images`
```
id uuid PK | plant_id uuid → plants | grow_id uuid → grows | user_id uuid → auth.users
storage_path text (Supabase Storage path) | taken_at timestamptz | source image_source | notes text | created_at
```
RLS: `grow member read`, `uploader write` (insert only, `user_id = auth.uid()`). All reads in app go via server-signed download URLs — no direct browser download.

#### `plant_observations`
```
id uuid PK | plant_id | grow_id | user_id → auth.users | observed_at | height_cm numeric(6,2) | notes | created_at
```
RLS: `grow member read`, `author write` (insert).

#### `plant_findings`
```
id uuid PK | plant_id | grow_id | image_id → plant_images (nullable) | category finding_category
severity finding_severity | title text | description text | recommendation text | resolved_at
created_at | source text CHECK ('ai','user_reported') DEFAULT 'ai'
confidence_score numeric(3,2) CHECK (0–1, nullable)
```
RLS: `grow member read`. AI writes via service role (no user INSERT policy for `source='ai'`). User-reported: `grow contributor user-report` (INSERT only, source must be `'user_reported'`, owner/collaborator only). UPDATE guard trigger (`plant_findings_user_update_guard`, SECURITY INVOKER): only `resolved_at` is user-mutable; `source` is immutable post-insert. High/critical findings auto-spawn a `grow_tasks` row (migration 008 trigger).

**Realtime:** `plant_findings` is in the `supabase_realtime` publication (added in migration 006).

#### `plant_analyses`
```
id uuid PK | plant_id | grow_id | image_id uuid UNIQUE → plant_images | compared_to_image_id nullable
overall_health_score numeric(5,1) | summary text | comparison_summary text | analyzed_at
model_version text | analysis_mode text CHECK ('model','fallback') | is_fallback bool | fallback_reason text
request_id text | created_at
```
RLS: `grow member read`. Service-role writes only. **Realtime** enabled (migration 006).

#### `analysis_jobs`
```
id uuid PK | plant_id | image_id | grow_id | requested_by uuid → auth.users
status text CHECK ('queued','running','succeeded','failed','retrying','cancelled')
attempt_count int | max_attempts int | idempotency_key text | queued_at | started_at | finished_at
next_attempt_at | locked_at | locked_by | error_code | error_message
result_analysis_id → plant_analyses (nullable) | created_at | updated_at
```
RLS: `grow member read`. Writes via `enqueue_analysis_job(...)` RPC (service-role only — see RPCs below).

#### `grow_events`
```
id uuid PK | grow_id | plant_id nullable | user_id | event_type event_type | notes | occurred_at | created_at
```
RLS: `grow member read`, `member write` (insert, user must be member).

#### `chat_threads`
```
id uuid PK | user_id → auth.users | grow_id nullable → grows | title text | created_at | updated_at
```
RLS: `owner only` (all). Trigger: `trg_chat_threads_updated_at`.

#### `chat_messages`
```
id uuid PK | thread_id → chat_threads | role message_role | content text | metadata jsonb | created_at
```
RLS: `thread owner read`. Service-role writes only (no user INSERT policy).

#### `chat_message_attachments`
```
id uuid PK | message_id → chat_messages | kind text CHECK ('image') | plant_id | image_id → plant_images
analysis_id nullable → plant_analyses | storage_path text | created_at
```
RLS: `thread owner read`. Service-role writes only.

#### `grow_tasks`
```
id uuid PK | grow_id | plant_id nullable | finding_id uuid UNIQUE nullable → plant_findings
title text | description text | priority task_priority | status task_status | due_at | created_at | updated_at | completed_at
```
RLS: `grow member read`, `contributor insert` (owner/collaborator), `contributor update` (owner/collaborator), `owner delete`. Trigger: `grow_tasks_touch_updated_at` (also stamps `completed_at` on terminal transition). Auto-created for high/critical findings via `plant_findings_auto_task` trigger.

#### `notifications`
```
id uuid PK | user_id → auth.users | kind notification_kind | priority notification_priority
title text | body text | payload jsonb | occurred_on date | read_at timestamptz | email_sent_at timestamptz | created_at
```
RLS: `self read`, `self resolve` (UPDATE; only `read_at` is mutable — `notifications_user_update_guard` trigger blocks all other columns; `email_sent_at` is also immutable from user context). Service-role writes only.
Deduplication: partial UNIQUE `(user_id, kind, occurred_on) WHERE occurred_on IS NOT NULL` for daily summaries; partial UNIQUE `(user_id, (payload->>'findingId')) WHERE kind='finding_alert'` (migration 016).

#### `user_preferences`
```
user_id uuid PK → auth.users | timezone text DEFAULT 'UTC' | email_daily_summary bool DEFAULT true
email_finding_alerts bool DEFAULT true | email_alert_severity_floor text CHECK ('info','low','medium','high','critical') DEFAULT 'critical'
created_at | updated_at
```
RLS: `self read`, `self upsert` (INSERT), `self update`. Timezone validated by `user_preferences_validate_timezone` BEFORE trigger against `pg_catalog.pg_timezone_names` (errcode `22023`). Write path: `.upsert({...}, { onConflict: 'user_id' })`.

---

## 5. Storage

**Bucket:** `plant-images` — **private** (never public).

```sql
-- From migration 002
insert into storage.buckets (id, name, public) values ('plant-images', 'plant-images', false);
```

Storage policies:
- `authenticated upload`: authenticated role may INSERT to `plant-images`.
- `owner delete`: authenticated user may DELETE where `storage.foldername(name)[1] = auth.uid()::text`.
- **No select policy** for users. Reads are server-signed download URLs only.

**In app code (`apps/web/src/lib/server/storage.ts`):**
- `getStorageClient()` uses the service-role key.
- Upload URLs: `/api/uploads/sign` route generates signed upload URLs.
- Download URLs: server-issued signed download URLs per request.

⚠️ Never add a public bucket for user content. Never grant storage reads to `authenticated` or `anon` for user-uploaded content.

---

## 6. Extensions

All extensions live in the `extensions` schema (not `public`) per migrations 013 and 019.

| Extension | Schema | Purpose |
|---|---|---|
| `pgcrypto` | `public` | `gen_random_uuid()` — available everywhere |
| `vector` (pgvector) | `extensions` | `plant_findings.embedding` column + IVFFlat cosine index |
| `pg_trgm` | `extensions` | GIN trigram indexes on grows/plants names, `search_grows`/`search_plants` RPCs |

**Search path:** `anon`, `authenticated`, `service_role` all have `search_path = "$user", public, extensions` (set in migration 013). This means unqualified `vector` and `similarity()` calls resolve correctly without fully qualifying.

**pgvector column:** `plant_findings.embedding vector(...)` with index `idx_plant_findings_embedding` using `vector_cosine_ops`. Zero non-NULL embeddings currently.

---

## 7. Stored Functions & RPCs

### Trigger-only functions (no RPC access)
| Function | Trigger | Notes |
|---|---|---|
| `handle_new_user()` | `trg_on_auth_user_created` AFTER INSERT on `auth.users` | SECURITY DEFINER, creates `profiles` row |
| `update_updated_at()` | `trg_*_updated_at` tables | SECURITY INVOKER, search_path=public |
| `grow_insert_owner_member()` | `trg_grows_insert_owner_member` AFTER INSERT on `grows` | SECURITY DEFINER; no RPC — revoked from public/anon/authenticated |
| `plant_findings_auto_task()` | `trg_plant_findings_auto_task` AFTER INSERT on `plant_findings` | SECURITY DEFINER; no RPC — revoked |
| `plant_findings_user_update_guard()` | BEFORE UPDATE on `plant_findings` | SECURITY INVOKER; only `resolved_at` mutable by users |
| `notifications_user_update_guard()` | BEFORE UPDATE on `notifications` | SECURITY INVOKER; only `read_at` mutable by users |
| `user_preferences_validate_timezone()` | BEFORE INSERT/UPDATE on `user_preferences` | validates against `pg_catalog.pg_timezone_names` |
| `grow_tasks_touch_updated_at()` | BEFORE UPDATE on `grow_tasks` | stamps `completed_at` on terminal transitions |

### RPCs (callable via PostgREST)
| Function | Caller | Notes |
|---|---|---|
| `enqueue_analysis_job(plant_id, image_id, grow_id, requested_by, idempotency_key, max_attempts)` | `service_role` only | Idempotent via partial unique index on `(image_id, idempotency_key)`. Revoked from `public`, `anon`, `authenticated`. |
| `search_grows(q, include_archived, max_results)` | `authenticated`, `service_role` | SECURITY INVOKER, RLS applies. GIN trigram + ILIKE union, ranked by similarity. |
| `search_plants(q, scope_grow_id, include_archived, max_results)` | `authenticated`, `service_role` | SECURITY INVOKER, RLS applies. |

---

## 8. Realtime

The following tables are in the `supabase_realtime` publication (added in migration 006):
- `public.plant_analyses`
- `public.plant_findings`
- `public.plant_images`

**Client-side subscription** lives in `apps/web/src/lib/use-live-analysis.ts` — uses `createSupabaseBrowserClient()` (anon key). RLS enforces ownership; the subscription only delivers rows the user can SELECT.

---

## 9. Migration Conventions

- Files live in `supabase/migrations/` with format `NNN_description.sql` (older) or `YYYYMMDDHHMMSS_description.sql` (Supabase CLI timestamp format, newer).
- **Never edit a committed migration.** Add a new numbered file.
- Always create a new file with `supabase migration new <name>` — never invent the filename manually.
- Every migration that introduces a function must include rollback instructions in a comment block.
- New tables: must have `enable row level security` + at least one policy before they are useful.
- New functions accessed only by triggers: include `revoke execute ... from public, anon, authenticated;` (see migration 012 pattern).
- CHECK constraints cannot reference subqueries or system catalog views — use a BEFORE trigger with `errcode = '22023'` for catalog-backed validation (see `user_preferences_validate_timezone`).

**Schema-change workflow (safe iteration before committing):**
1. Iterate with `execute_sql` (MCP) or `supabase db query` (CLI ≥ v2.79.0) — no migration history entries.
2. Run `supabase db advisors` (CLI ≥ v2.81.3) or MCP `get_advisors`. Fix any issues.
3. Apply security checklist (RLS, views, SECURITY DEFINER search_path, function grants).
4. `supabase db pull <name> --local --yes` to generate the migration file.
5. Verify: `supabase migration list --local`.

---

## 10. RLS Patterns Used in PhenoSage

### "Grow member read" (most tables)
```sql
using (
  exists (
    select 1 from grows g
    left join grow_members gm on gm.grow_id = g.id
    where g.id = <table>.grow_id
      and (g.owner_id = auth.uid() or gm.user_id = auth.uid())
  )
)
```

### "Self only" (profiles, notifications, user_preferences)
```sql
using (auth.uid() = user_id)
```

### "Service role only" writes
No user-facing INSERT policy. The app server uses `getDbClient()` (service role) to write. Example tables: `plant_findings` (AI source), `chat_messages`, `notifications`.

### Column-restriction triggers
Used on `notifications` and `plant_findings` to limit what users can UPDATE — only `read_at` (notifications) or `resolved_at` (plant_findings) may change. Service role bypasses via `if auth.uid() is null then return new; end if`.

### RLS performance note
`grow_members` is queried in nearly every policy. Ensure `idx_grow_members_user_id` (or equivalent) exists. Use `explain analyze` on slow queries — RLS subqueries are the most common hotspot.

---

## 11. Security Checklist for PhenoSage Schema Changes

Before opening a migration PR, verify:

- [ ] Every new table in `public` has `enable row level security` + at least one SELECT policy.
- [ ] New SECURITY DEFINER functions are in `public` with `set search_path = public` and have `revoke execute ... from public, anon, authenticated` if they should only run from triggers or service role.
- [ ] No new view accesses RLS-protected tables without `WITH (security_invoker = true)` (Postgres 15+).
- [ ] UPDATE-only policies also have a SELECT policy (otherwise updates silently return 0 rows).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` not referenced in any client bundle path.
- [ ] Storage: new buckets for user content are **private**; server issues signed URLs.
- [ ] `user_metadata` / `raw_user_meta_data` is never used in an RLS policy (user-editable; unsafe). Use `app_metadata` only.

---

## 12. Common Ops Tasks

### Check RLS coverage
```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```
Any row where `rowsecurity = false` is a gap.

### Check which functions are callable by anon/authenticated
```sql
select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can_exec
from pg_proc p
cross join (values ('anon'), ('authenticated')) as r(rolname)
where p.pronamespace = 'public'::regnamespace
  and p.proname not like 'pg_%'
order by p.proname, r.rolname;
```

### Check tables in Realtime publication
```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
```

### Find missing FK indexes
```sql
select conrelid::regclass as tbl, a.attname as col
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.contype = 'f'
  and not exists (
    select 1 from pg_index i
    where i.indrelid = c.conrelid
      and (i.indkey::int2[])[0] = a.attnum
  );
```

### Seed a test grow (service role, dev only)
```sql
-- Use execute_sql MCP tool; never run against production without approval
insert into grows (owner_id, name, stage, medium, light_type)
values ('<user_id>', 'Test Grow', 'vegetative', 'soil', 'led');
```

### Inspect an analysis job
```sql
select id, status, attempt_count, error_code, error_message, queued_at, finished_at
from analysis_jobs
where image_id = '<image_id>'
order by queued_at desc
limit 5;
```

---

## 13. Known Gotchas

1. **`enqueue_analysis_job` race:** The function uses `ON CONFLICT (image_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET id = id` — the self-update is a no-op whose only purpose is to make `RETURNING *` yield the existing row. This is intentional.

2. **`plant_findings` no-service-role insert policy is intentional:** AI findings land via service role (bypasses RLS). User-reported findings use the `grow contributor user-report` policy with `source = 'user_reported'` enforced. Do not add a blanket insert policy.

3. **pgvector in `extensions` schema:** The `vector` type is accessed as `vector` in SQL (not `extensions.vector`) because `extensions` is in the search_path for `anon`/`authenticated`/`service_role`. If you see `type "vector" does not exist`, check that the role's search_path includes `extensions`.

4. **`supabase_realtime` publication:** Only `plant_analyses`, `plant_findings`, and `plant_images` are in the publication. Adding a new table requires an explicit `alter publication supabase_realtime add table public.<name>` in a DO block (see migration 006 pattern).

5. **`notifications` UPDATE guard covers `email_sent_at`:** Migration 018 re-creates `notifications_user_update_guard()` to also block user changes to `email_sent_at`. If you add a new column to `notifications`, re-create the trigger function to include it in the immutable-column guard if users should not be able to change it.

6. **`grows` owner auto-added to `grow_members`:** The `grow_insert_owner_member` trigger (migration 011) runs AFTER INSERT on `grows` and inserts the owner as a `grow_members` row with role `owner`. RLS policies on downstream tables rely on this — the `left join grow_members` pattern works because the owner also has a row there.
