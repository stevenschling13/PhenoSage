# PhenoSage — Supabase Production Guide

**Covers:** Connection pooling, PITR, backups, monitoring, audit trail, soft deletes, pgvector, performance tuning, security, and troubleshooting.

---

## Table of Contents

1. [PgBouncer — Connection Pooling](#1-pgbouncer--connection-pooling)
2. [PITR — Point-in-Time Recovery](#2-pitr--point-in-time-recovery)
3. [Backup Strategy](#3-backup-strategy)
4. [Monitoring & Alerting](#4-monitoring--alerting)
5. [Audit Trail Usage](#5-audit-trail-usage)
6. [Soft Delete Enforcement](#6-soft-delete-enforcement)
7. [pgvector & Semantic Search](#7-pgvector--semantic-search)
8. [Performance Tuning](#8-performance-tuning)
9. [Security Best Practices](#9-security-best-practices)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. PgBouncer — Connection Pooling

### Why it matters

Postgres maintains a dedicated OS process per connection. Without pooling, a burst of concurrent requests — photo uploads triggering analysis, cron jobs, chat completions — can exhaust `max_connections` (typically 60–90 on Supabase free/pro tiers). When that happens, new connections are refused with:

```
FATAL: remaining connection slots are reserved for non-replication superuser connections
```

PgBouncer sits in front of Postgres and multiplexes many application connections onto a small number of real database connections, eliminating this problem.

### Enabling PgBouncer in Supabase

Supabase provides a managed PgBouncer instance on every project. No installation required.

1. Go to **Project Settings → Database**
2. Under **Connection pooling**, toggle it **on**
3. Note the **pooler connection string** — it uses port `6543` instead of `5432`

You will see two connection strings:

| Mode | Port | Use for |
|---|---|---|
| Direct (Postgres) | `5432` | Migrations, long-lived admin sessions |
| Pooler (PgBouncer) | `6543` | All application traffic |

### Recommended settings

Supabase defaults to **transaction mode**, which is correct for PhenoSage. In transaction mode, a server connection is held only for the duration of a single transaction, then returned to the pool.

```
# In Supabase Dashboard → Settings → Database → Connection pooling
Pool mode:        Transaction
Pool size:        15  (see calculation below)
Idle timeout:     3s
```

**Pool size calculation:**

```
pool_size = floor(max_connections × 0.8 / num_app_instances)

# Example: Supabase Pro (max_connections = 90), 2 Vercel serverless regions
pool_size = floor(90 × 0.8 / 2) = 36 per region

# Conservative starting point: 15–20 per region
```

Reserve ~20% of `max_connections` for direct admin connections and Supabase internal processes.

### Updating your connection string

In `apps/web` (Vercel) and `apps/analysis` (Railway), use the **pooler** connection string for all runtime database access. The `@supabase/supabase-js` client connects via the REST/PostgREST layer (not raw TCP), so it is already pooled automatically — no changes needed there.

If you ever add a direct `pg` or `postgres` driver (e.g., for a migration script or background worker), use:

```
# Runtime (pooled) — use this in application code
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

# Direct (unpooled) — use this for migrations only
DATABASE_URL_DIRECT=postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres
```

### When to use direct connections

Use the **direct** connection (port `5432`) only for:

- Running `supabase db push` migrations
- `pg_dump` / `pg_restore` backup operations
- `LISTEN`/`NOTIFY` (not supported in transaction mode)
- Prepared statements that span multiple transactions

Use the **pooler** connection (port `6543`) for everything else.

---

## 2. PITR — Point-in-Time Recovery

### What it is

PITR continuously archives Postgres WAL (write-ahead log) segments to object storage. If data is accidentally deleted or corrupted, you can restore the database to any second within the retention window — not just the last daily snapshot.

### Enabling PITR

PITR is available on **Supabase Pro** and above.

1. Go to **Project Settings → Backups**
2. Under **Point in Time Recovery**, click **Enable PITR**
3. Select a retention period (see recommendations below)
4. Confirm — this takes a few minutes to activate

> **Cost note:** PITR is billed per GB of WAL storage per month. A typical PhenoSage project at early scale generates < 1 GB/day of WAL. At Supabase's current pricing (~$0.10/GB/month), a 7-day retention window costs roughly $0.70/month. A 30-day window costs ~$3/month. Check the [Supabase pricing page](https://supabase.com/pricing) for current rates.

### Retention period recommendations

| Stage | Retention | Rationale |
|---|---|---|
| Development / staging | 7 days | Minimal cost; enough to catch mistakes |
| Early production (< 1k users) | 14 days | Covers a two-week sprint cycle |
| Growth (1k–10k users) | 30 days | Covers month-end billing disputes, slow-burn data corruption |
| Enterprise | 90 days | Compliance, audit requirements |

Start with **14 days** for production. Increase as user data becomes more valuable.

### Restoring from a point in time

1. Go to **Project Settings → Backups → Point in Time Recovery**
2. Click **Restore to a point in time**
3. Enter the target timestamp (UTC) — e.g., `2024-11-15 14:32:00`
4. Supabase will provision a **new project** with the restored data
5. Verify the restored data is correct before switching traffic
6. Update environment variables in Vercel and Railway to point to the new project URL

> **Important:** PITR restore creates a new project, not an in-place rollback. Plan for a brief maintenance window to update connection strings and re-run any migrations applied after the restore point.

### Testing your recovery

Run a recovery drill quarterly:

```bash
# 1. Note the current timestamp
echo "Restore target: $(date -u '+%Y-%m-%d %H:%M:%S') UTC"

# 2. Insert a canary row
supabase db execute --sql "INSERT INTO grows (owner_id, name, stage, medium, light_type) VALUES (gen_random_uuid(), '__PITR_TEST__', 'seedling', 'soil', 'led');"

# 3. Trigger a PITR restore to 5 minutes before the canary insert
# (via Supabase Dashboard)

# 4. Verify the canary row does NOT exist in the restored project
# 5. Verify all real data IS present
# 6. Delete the test project
```

---

## 3. Backup Strategy

### Supabase automatic daily backups

Supabase takes a full logical backup (`pg_dump`) of your database every day at approximately 00:00 UTC. These are retained for:

- **Free tier:** 1 day
- **Pro tier:** 7 days
- **Pro + PITR:** 7 days of daily snapshots + continuous WAL

Daily backups are accessible from **Project Settings → Backups → Database Backups**.

### Downloading a backup

```bash
# From the Supabase Dashboard:
# Settings → Backups → Database Backups → Download

# Or via the Supabase CLI (requires Pro):
supabase db dump --file phenosage_backup_$(date +%Y%m%d).sql
```

### Off-site backup (recommended for production)

Do not rely solely on Supabase backups. Set up an independent off-site backup:

```bash
#!/bin/bash
# scripts/backup.sh — run via cron or Railway cron job

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="phenosage_${TIMESTAMP}.sql.gz"
S3_BUCKET="s3://your-backup-bucket/phenosage/"

# Dump using direct connection (not pooler)
pg_dump "$DATABASE_URL_DIRECT" \
  --no-owner \
  --no-acl \
  --format=plain \
  | gzip > "/tmp/${BACKUP_FILE}"

# Upload to S3 (or any object storage)
aws s3 cp "/tmp/${BACKUP_FILE}" "${S3_BUCKET}${BACKUP_FILE}"

# Verify upload
aws s3 ls "${S3_BUCKET}${BACKUP_FILE}"

# Clean up local file
rm "/tmp/${BACKUP_FILE}"

echo "Backup complete: ${S3_BUCKET}${BACKUP_FILE}"
```

Schedule this to run daily, offset from Supabase's own backup window (e.g., 02:00 UTC).

### Testing restore procedures

A backup you have never tested is not a backup. Run a restore test monthly:

```bash
# 1. Download the latest backup
supabase db dump --file test_restore.sql

# 2. Spin up a local Postgres instance
docker run -d \
  --name phenosage-restore-test \
  -e POSTGRES_PASSWORD=testpass \
  -p 5433:5432 \
  postgres:15

# 3. Restore into it
psql postgresql://postgres:testpass@localhost:5433/postgres < test_restore.sql

# 4. Spot-check critical tables
psql postgresql://postgres:testpass@localhost:5433/postgres \
  -c "SELECT count(*) FROM grows; SELECT count(*) FROM plants; SELECT count(*) FROM plant_findings;"

# 5. Tear down
docker rm -f phenosage-restore-test
rm test_restore.sql
```

---

## 4. Monitoring & Alerting

### Key metrics to watch

| Metric | Warning threshold | Critical threshold | Where to find it |
|---|---|---|---|
| Active connections | > 70% of `max_connections` | > 90% | Supabase Dashboard → Reports → Database |
| Query latency (p99) | > 500ms | > 2s | Supabase Dashboard → Reports → Queries |
| Cache hit ratio | < 95% | < 90% | `pg_stat_bgwriter` (see query below) |
| Disk usage | > 70% | > 85% | Supabase Dashboard → Settings → Database |
| Replication lag | > 10s | > 60s | Supabase Dashboard → Reports |

### Checking cache hit ratio

A cache hit ratio below 95% means Postgres is reading from disk frequently — a sign you need more RAM or better indexes.

```sql
-- Run in Supabase SQL Editor
SELECT
  sum(heap_blks_hit)  AS heap_hits,
  sum(heap_blks_read) AS heap_reads,
  round(
    sum(heap_blks_hit)::numeric /
    nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100,
    2
  ) AS cache_hit_ratio_pct
FROM pg_statio_user_tables;
```

### Checking active connections

```sql
-- Current connection count by state
SELECT state, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state
ORDER BY count DESC;

-- Max connections configured
SHOW max_connections;
```

### Setting up Supabase alerts

1. Go to **Project Settings → Alerts**
2. Add your email or Slack webhook
3. Enable alerts for:
   - **High database load** (CPU > 80%)
   - **High disk usage** (> 75%)
   - **Connection count spike**

For more granular alerting, export metrics to an external system:

```bash
# Supabase exposes Prometheus-compatible metrics on Pro+
# Endpoint: https://<project-ref>.supabase.co/customer/v1/privileged/metrics
# Requires service role key in Authorization header

curl -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "https://${SUPABASE_PROJECT_REF}.supabase.co/customer/v1/privileged/metrics"
```

Pipe this into Grafana, Datadog, or any Prometheus-compatible stack.

### Slow query log

Supabase logs queries slower than `log_min_duration_statement` (default: 250ms on Pro).

```sql
-- View recent slow queries
SELECT
  query,
  calls,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  round(total_exec_time::numeric, 2) AS total_ms,
  rows
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

Enable `pg_stat_statements` if not already active:

```sql
-- Check if enabled
SELECT * FROM pg_extension WHERE extname = 'pg_stat_statements';

-- Enable (requires superuser — use Supabase SQL Editor)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

### Identifying N+1 queries

N+1 queries are the most common performance killer in Next.js apps. They appear as many near-identical queries with low individual latency but high aggregate cost.

```sql
-- Find queries called > 100 times with similar patterns
SELECT
  left(query, 120) AS query_snippet,
  calls,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  round((calls * mean_exec_time)::numeric, 2) AS total_ms
FROM pg_stat_statements
WHERE calls > 100
ORDER BY total_ms DESC
LIMIT 20;
```

If you see `SELECT * FROM plants WHERE id = $1` called 50 times in a single request, you have an N+1. Fix it by batching: `SELECT * FROM plants WHERE id = ANY($1)`.

---

## 5. Audit Trail Usage

### What migration 003 adds

`003_production_optimizations.sql` adds `created_by` and `updated_by` columns (UUID, references `auth.users`) to `grows`, `plants`, and `plant_findings`. These are populated automatically via triggers whenever a row is inserted or updated.

```sql
-- Schema added by 003_production_optimizations.sql
ALTER TABLE grows
  ADD COLUMN created_by uuid REFERENCES auth.users(id),
  ADD COLUMN updated_by uuid REFERENCES auth.users(id);

ALTER TABLE plants
  ADD COLUMN created_by uuid REFERENCES auth.users(id),
  ADD COLUMN updated_by uuid REFERENCES auth.users(id);
```

The trigger sets `updated_by` to `auth.uid()` on every update, and `created_by` on insert.

### Querying audit history

**Who last changed a plant's name, and when?**

```sql
SELECT
  p.id,
  p.name,
  p.updated_at,
  pr.display_name AS last_updated_by
FROM plants p
LEFT JOIN profiles pr ON pr.id = p.updated_by
WHERE p.id = '<plant-uuid>';
```

**Which plants in a grow were modified in the last 24 hours, and by whom?**

```sql
SELECT
  p.name AS plant_name,
  p.updated_at,
  pr.display_name AS updated_by
FROM plants p
LEFT JOIN profiles pr ON pr.id = p.updated_by
WHERE p.grow_id = '<grow-uuid>'
  AND p.updated_at > now() - interval '24 hours'
ORDER BY p.updated_at DESC;
```

**All changes made by a specific user across all their grows:**

```sql
SELECT
  'grow'  AS entity_type,
  g.id    AS entity_id,
  g.name,
  g.updated_at
FROM grows g
WHERE g.updated_by = '<user-uuid>'

UNION ALL

SELECT
  'plant' AS entity_type,
  p.id    AS entity_id,
  p.name,
  p.updated_at
FROM plants p
WHERE p.updated_by = '<user-uuid>'

ORDER BY updated_at DESC
LIMIT 50;
```

### Limitations

The `created_by` / `updated_by` pattern records **who** made the last change and **when**, but does **not** record the previous values. You cannot answer "what was the plant's name before it was changed?" with this approach alone.

For full change history (old values + new values), use the `pgaudit` extension or implement an event-sourcing pattern with a dedicated `audit_log` table:

```sql
-- Example audit_log table (not in current migrations — add if needed)
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name  text NOT NULL,
  row_id      uuid NOT NULL,
  operation   text NOT NULL,  -- INSERT, UPDATE, DELETE
  changed_by  uuid REFERENCES auth.users(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  old_data    jsonb,
  new_data    jsonb
);
```

---

## 6. Soft Delete Enforcement

### How it works

`grows` and `plants` both have an `is_archived boolean NOT NULL DEFAULT false` column (from `001_initial_schema.sql`). Migration `003_production_optimizations.sql` updates the RLS `SELECT` policies to filter out archived rows by default, so archived records are invisible to normal queries.

The updated policies look like:

```sql
-- grows: member read (updated in 003)
CREATE POLICY "grows: member read"
  ON grows FOR SELECT
  USING (
    is_archived = false
    AND (
      auth.uid() = owner_id
      OR EXISTS (
        SELECT 1 FROM grow_members gm
        WHERE gm.grow_id = grows.id AND gm.user_id = auth.uid()
      )
    )
  );

-- plants: grow member read (updated in 003)
CREATE POLICY "plants: grow member read"
  ON plants FOR SELECT
  USING (
    is_archived = false
    AND EXISTS (
      SELECT 1 FROM grows g
      LEFT JOIN grow_members gm ON gm.grow_id = g.id
      WHERE g.id = plants.grow_id
        AND (g.owner_id = auth.uid() OR gm.user_id = auth.uid())
    )
  );
```

### Archiving a record

From a Next.js API route using the service role client:

```typescript
// Archive a grow (soft delete)
const { error } = await getDbClient()
  .from("grows")
  .update({ is_archived: true, updated_at: new Date().toISOString() })
  .eq("id", growId)
  .eq("owner_id", userId); // always scope to owner

if (error) throw error;
```

After this update, the grow and all its plants disappear from all RLS-filtered queries automatically. No application-level filtering needed.

### Querying archived records

Archived records are only accessible via the **service role** client (which bypasses RLS). Never expose this to the browser.

```typescript
// In a Next.js API route — list all archived grows for a user
const { data, error } = await getDbClient()
  .from("grows")
  .select("id, name, updated_at")
  .eq("owner_id", userId)
  .eq("is_archived", true)
  .order("updated_at", { ascending: false });
```

Or directly in SQL (e.g., for admin queries in the Supabase SQL Editor):

```sql
-- All archived grows
SELECT id, name, owner_id, updated_at
FROM grows
WHERE is_archived = true
ORDER BY updated_at DESC;

-- Archived plants within a specific grow
SELECT id, name, updated_at
FROM plants
WHERE grow_id = '<grow-uuid>'
  AND is_archived = true;
```

### Restoring an archived record

```typescript
// Restore a soft-deleted plant
const { error } = await getDbClient()
  .from("plants")
  .update({ is_archived: false, updated_at: new Date().toISOString() })
  .eq("id", plantId);

if (error) throw error;
```

Once `is_archived` is set back to `false`, the record reappears in all normal RLS-filtered queries immediately.

### Cascading archives

Archiving a grow does **not** automatically archive its plants — the plants remain in the database with `is_archived = false`. However, because the `plants` RLS policy joins through `grows`, and the archived grow is now invisible, the plants are also effectively hidden from normal queries.

If you need to explicitly archive all plants in a grow (e.g., for data hygiene):

```typescript
// Archive all plants in a grow
await getDbClient()
  .from("plants")
  .update({ is_archived: true })
  .eq("grow_id", growId);
```

---

## 7. pgvector & Semantic Search

### What pgvector is

`pgvector` is a Postgres extension that adds a native vector data type and approximate nearest-neighbor (ANN) search operators. It lets you store high-dimensional embeddings (arrays of floats) directly in Postgres and query for semantically similar rows — without a separate vector database.

### Why it matters for PhenoSage

PhenoSage generates structured findings for every plant analysis. With pgvector, you can answer questions like:

- "Have I seen this nutrient deficiency pattern before in any of my grows?"
- "Which of my past plants had similar symptoms to this one?"
- "Find all findings similar to 'yellowing lower leaves with brown tips'"

This powers the **"Ask about any past grow"** feature planned for Milestone 3.

### Enabling pgvector

Migration `003_production_optimizations.sql` enables the extension and adds an `embedding` column to `plant_findings`:

```sql
-- Enabled in 003_production_optimizations.sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE plant_findings
  ADD COLUMN embedding vector(1536);  -- OpenAI text-embedding-3-small dimensions

CREATE INDEX idx_plant_findings_embedding
  ON plant_findings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

### Generating embeddings

Use OpenAI's `text-embedding-3-small` model (1536 dimensions, fast, cheap):

```typescript
// apps/web/src/lib/server/embeddings.ts
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateFindingEmbedding(finding: {
  title: string;
  description: string;
  category: string;
  severity: string;
}): Promise<number[]> {
  // Combine the most semantically meaningful fields
  const text = [
    finding.title,
    finding.description,
    `Category: ${finding.category}`,
    `Severity: ${finding.severity}`,
  ].join(". ");

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  return response.data[0].embedding;
}
```

Store the embedding when a finding is created:

```typescript
// After creating a plant_finding, generate and store its embedding
const embedding = await generateFindingEmbedding(finding);

await getDbClient()
  .from("plant_findings")
  .update({ embedding: JSON.stringify(embedding) })
  .eq("id", finding.id);
```

### Querying for similar findings

```typescript
// Find the 5 most similar findings to a given finding
export async function findSimilarFindings(
  embedding: number[],
  excludeFindingId: string,
  userId: string,
  limit = 5,
) {
  // pgvector cosine distance operator: <=>
  // Lower distance = more similar (0 = identical, 2 = opposite)
  const { data, error } = await getDbClient().rpc("find_similar_findings", {
    query_embedding: JSON.stringify(embedding),
    exclude_id: excludeFindingId,
    match_count: limit,
  });

  if (error) throw error;
  return data;
}
```

Define the RPC function in a migration:

```sql
-- Add to a future migration
CREATE OR REPLACE FUNCTION find_similar_findings(
  query_embedding vector(1536),
  exclude_id      uuid,
  match_count     int DEFAULT 5
)
RETURNS TABLE (
  id          uuid,
  title       text,
  description text,
  category    finding_category,
  severity    finding_severity,
  similarity  float
)
LANGUAGE sql STABLE AS $$
  SELECT
    pf.id,
    pf.title,
    pf.description,
    pf.category,
    pf.severity,
    1 - (pf.embedding <=> query_embedding) AS similarity
  FROM plant_findings pf
  WHERE pf.id != exclude_id
    AND pf.embedding IS NOT NULL
  ORDER BY pf.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

### Performance tuning — IVFFlat `lists` parameter

The `IVFFlat` index divides the vector space into `lists` clusters. At query time, Postgres searches only the nearest clusters (controlled by `ivfflat.probes`).

**Choosing `lists`:**

| Row count | Recommended `lists` |
|---|---|
| < 1,000 | No index needed — use sequential scan |
| 1,000 – 100,000 | `sqrt(rows)` — e.g., 100 for 10k rows |
| > 100,000 | `rows / 1000` |

**Choosing `probes` at query time:**

```sql
-- Higher probes = better recall, slower query
-- Default is 1; 10 is a good balance for most cases
SET ivfflat.probes = 10;

SELECT id, title, 1 - (embedding <=> '[...]'::vector) AS similarity
FROM plant_findings
ORDER BY embedding <=> '[...]'::vector
LIMIT 5;
```

**Rebuild the index after bulk inserts:**

```sql
-- IVFFlat index quality degrades if many rows are added after creation
-- Rebuild periodically (e.g., after importing historical data)
REINDEX INDEX idx_plant_findings_embedding;
```

---

## 8. Performance Tuning

### Index usage and maintenance

The indexes defined in `001_initial_schema.sql` and `003_production_optimizations.sql` cover the most common query patterns. Verify they are being used:

```sql
-- Check index usage across all tables
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan   AS times_used,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

An index with `idx_scan = 0` after a week of production traffic is likely unused and should be dropped (it still costs write overhead).

**Update statistics after bulk operations:**

```sql
-- After bulk inserts or imports, update the query planner's statistics
ANALYZE grows;
ANALYZE plants;
ANALYZE plant_findings;

-- Or update all tables at once
ANALYZE;
```

**Rebuild bloated indexes:**

```sql
-- Check index bloat
SELECT
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;

-- Rebuild a specific index (locks the table briefly)
REINDEX INDEX idx_plant_findings_plant_id;

-- Rebuild without locking (Postgres 12+)
REINDEX INDEX CONCURRENTLY idx_plant_findings_plant_id;
```

### Query planning with EXPLAIN ANALYZE

Always use `EXPLAIN (ANALYZE, BUFFERS)` to diagnose slow queries — never guess:

```sql
-- Example: diagnose a slow plant timeline query
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  pi.id,
  pi.storage_path,
  pi.taken_at,
  pf.title,
  pf.severity
FROM plant_images pi
LEFT JOIN plant_findings pf ON pf.image_id = pi.id
WHERE pi.plant_id = '<plant-uuid>'
ORDER BY pi.taken_at DESC
LIMIT 20;
```

Key things to look for in the output:

- **Seq Scan** on a large table → missing index
- **actual rows** much larger than **estimated rows** → stale statistics, run `ANALYZE`
- **Buffers: read** > 0 → data not in cache, consider adding RAM or optimizing the query
- **Nested Loop** with many iterations → potential N+1

### Identifying missing indexes

```sql
-- Tables with sequential scans (candidates for new indexes)
SELECT
  relname AS table_name,
  seq_scan,
  seq_tup_read,
  idx_scan,
  round(seq_tup_read::numeric / nullif(seq_scan, 0), 0) AS avg_rows_per_seq_scan
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC
LIMIT 10;
```

A table with high `seq_tup_read` and low `idx_scan` is being scanned in full repeatedly. Add an index on the most common `WHERE` clause column.

### Partial indexes for archived records

Archived rows (`is_archived = true`) are a small minority of the data but are included in full-table indexes, wasting space and slowing down index scans on active records.

Use partial indexes to index only active records:

```sql
-- Index only active grows (is_archived = false)
-- Added in 003_production_optimizations.sql
CREATE INDEX idx_grows_active_owner
  ON grows (owner_id)
  WHERE is_archived = false;

CREATE INDEX idx_plants_active_grow
  ON plants (grow_id)
  WHERE is_archived = false;
```

These indexes are smaller, faster to scan, and automatically used by queries that include `WHERE is_archived = false` in their filter.

### work_mem and shared_buffers

Supabase manages `shared_buffers` (typically 25% of RAM) automatically. You can tune `work_mem` per session for expensive sort/hash operations:

```sql
-- Increase work_mem for a single expensive query session
-- Default is 4MB; increase for sorts on large result sets
SET work_mem = '64MB';

-- Then run your expensive query
SELECT ...;

-- Reset to default
RESET work_mem;
```

Do **not** set `work_mem` globally to a high value — it is allocated per sort/hash operation per query, and a complex query can use it many times simultaneously.

---

## 9. Security Best Practices

### RLS policy review checklist

Run this checklist before every production deployment:

```sql
-- 1. Verify RLS is enabled on all user-facing tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
-- Every table should show rowsecurity = true

-- 2. List all policies
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;

-- 3. Test as an anonymous user (should return 0 rows for all tables)
SET ROLE anon;
SELECT count(*) FROM grows;
SELECT count(*) FROM plants;
SELECT count(*) FROM plant_findings;
RESET ROLE;
```

**Policy review rules:**

- Every `SELECT` policy must include `auth.uid()` in its `USING` clause — directly or via a subquery
- `INSERT` policies must use `WITH CHECK`, not `USING`
- Service-role-only tables (e.g., `plant_findings`, `chat_messages`) must have **no** user-facing insert policy
- Never use `USING (true)` on a table with sensitive data

### Storage policy hardening

Migration `003_production_optimizations.sql` tightens the upload policy to enforce the `plants/{plantId}/` folder structure:

```sql
-- Updated in 003_production_optimizations.sql
-- Replaces the loose "authenticated upload" policy from 002
DROP POLICY "plant-images: authenticated upload" ON storage.objects;

CREATE POLICY "plant-images: owner upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'plant-images'
    -- Enforce folder structure: plants/{plantId}/{filename}
    AND (storage.foldername(name))[1] = 'plants'
    -- Prevent users from uploading to other users' plant folders
    -- The plantId must belong to a grow the user owns or is a member of
    AND EXISTS (
      SELECT 1 FROM plants p
      JOIN grows g ON g.id = p.grow_id
      LEFT JOIN grow_members gm ON gm.grow_id = g.id
      WHERE p.id::text = (storage.foldername(name))[2]
        AND (g.owner_id = auth.uid() OR gm.user_id = auth.uid())
    )
  );
```

Verify storage policies are working:

```sql
-- List all storage policies
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects';
```

### Service role key rotation

The `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS. Rotate it if:

- A team member with access leaves
- You suspect the key was exposed (e.g., accidentally committed to git)
- As part of a quarterly security review

**To rotate:**

1. Go to **Project Settings → API → Service Role Key → Regenerate**
2. Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel environment variables
3. Update `SUPABASE_SERVICE_ROLE_KEY` in Railway environment variables
4. Redeploy both services
5. Verify health checks pass: `GET /api/health` (Vercel) and `GET /health` (Railway)

> **Never commit the service role key to git.** Audit your git history with `git log -S "SUPABASE_SERVICE_ROLE_KEY"` if you suspect a leak.

### Anon key restrictions

The `NEXT_PUBLIC_SUPABASE_ANON_KEY` is public — it is embedded in the browser bundle. It is safe to expose **only because RLS policies restrict what it can access**.

Ensure the anon key cannot:

- Read any row from `grows`, `plants`, or `plant_findings` (RLS requires `auth.uid()`)
- Upload to `plant-images` storage (policy requires `authenticated` role)
- Call any sensitive RPC functions

Test this periodically:

```sql
-- Simulate an unauthenticated request
SET ROLE anon;
SELECT * FROM grows LIMIT 1;       -- should return 0 rows
SELECT * FROM plant_findings LIMIT 1; -- should return 0 rows
RESET ROLE;
```

---

## 10. Troubleshooting

### Common errors and solutions

**`FATAL: remaining connection slots are reserved for non-replication superuser connections`**

The database has hit `max_connections`. Immediate actions:

1. Check current connections: `SELECT count(*) FROM pg_stat_activity;`
2. Kill idle connections: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '5 minutes';`
3. Verify your app is using the pooler connection string (port `6543`), not the direct connection
4. Reduce pool size in PgBouncer settings if over-provisioned

**`ERROR: new row violates row-level security policy`**

An insert or update was blocked by RLS. Diagnose:

```sql
-- Check which policies apply to the table
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'plants';  -- replace with your table

-- Test the policy condition manually
SELECT auth.uid();  -- confirm you are authenticated as the right user
```

Common causes:
- `user_id` field not set to `auth.uid()` on insert
- Trying to insert into a service-role-only table (e.g., `plant_findings`) with the anon key
- Missing grow membership record

**`ERROR: permission denied for table ...`**

RLS is enabled but there is no matching policy for the operation. Check:

```sql
SELECT policyname, cmd FROM pg_policies WHERE tablename = '<table>';
```

If no policy exists for the operation (e.g., `UPDATE`), the operation is denied for all non-superusers.

**`ERROR: operator does not exist: vector <=> unknown`**

The `pgvector` extension is not enabled, or the `embedding` column type is wrong:

```sql
-- Check if pgvector is enabled
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Enable it
CREATE EXTENSION IF NOT EXISTS vector;
```

### How to check RLS policies

```sql
-- All policies on a specific table
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual       AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'grows'
ORDER BY cmd;

-- Test a policy as a specific user
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "<user-uuid>", "role": "authenticated"}';
SELECT * FROM grows LIMIT 5;
RESET ROLE;
```

### How to debug storage policy failures

Storage policy failures surface as `403 Forbidden` from the Supabase Storage API. To debug:

```sql
-- List storage policies
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects';

-- Check what path the upload is attempting
-- The path must match: plants/{plantId}/{filename}
-- Verify foldername() parsing:
SELECT
  storage.foldername('plants/abc-123/photo.jpg') AS folders,
  storage.filename('plants/abc-123/photo.jpg')   AS filename;
-- Expected: folders = {plants,abc-123}, filename = photo.jpg
```

Common storage policy failure causes:

1. **Wrong path format** — the upload path does not match `plants/{plantId}/{filename}`
2. **Plant not found** — the `plantId` in the path does not exist or the user is not a member of its grow
3. **Wrong bucket** — uploading to a bucket other than `plant-images`
4. **Expired signed URL** — signed upload URLs expire after 60 seconds by default; regenerate if expired

### Connection pool exhaustion symptoms

Signs your connection pool is exhausted:

- Requests hang for 3–10 seconds then fail with a timeout
- `pg_stat_activity` shows many connections in `idle in transaction` state
- Vercel function logs show `Connection timeout` or `ECONNREFUSED`

Diagnosis:

```sql
-- Connections by state and application
SELECT
  application_name,
  state,
  count(*),
  max(now() - state_change) AS longest_in_state
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY application_name, state
ORDER BY count DESC;

-- Long-running transactions (potential connection hogs)
SELECT
  pid,
  now() - xact_start AS transaction_age,
  state,
  left(query, 100) AS query_snippet
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
  AND now() - xact_start > interval '30 seconds'
ORDER BY transaction_age DESC;
```

Resolution:

1. Terminate long-running idle transactions: `SELECT pg_terminate_backend(<pid>);`
2. Ensure all database calls in Next.js API routes complete within the function timeout
3. Avoid holding transactions open across `await` calls — complete the transaction in a single synchronous block
4. If using a raw `pg` client, always call `client.release()` in a `finally` block

---

## Quick Reference

### Connection strings

```bash
# Pooled (use in application code)
postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true

# Direct (use for migrations only)
postgresql://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres
```

### Essential SQL snippets

```sql
-- Check RLS status on all tables
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- Cache hit ratio
SELECT round(sum(heap_blks_hit)::numeric / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100, 2) AS cache_hit_pct FROM pg_statio_user_tables;

-- Active connections
SELECT state, count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY state;

-- Slow queries (top 10)
SELECT left(query, 80), calls, round(mean_exec_time::numeric, 1) AS mean_ms FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;

-- Unused indexes
SELECT indexname, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY indexname;
```

### Supabase Dashboard shortcuts

| Task | Path |
|---|---|
| Enable PITR | Settings → Backups → Point in Time Recovery |
| Download backup | Settings → Backups → Database Backups |
| Enable PgBouncer | Settings → Database → Connection pooling |
| View slow queries | Reports → Queries |
| Set up alerts | Settings → Alerts |
| Rotate service role key | Settings → API → Service Role Key |
| Run SQL | SQL Editor |
