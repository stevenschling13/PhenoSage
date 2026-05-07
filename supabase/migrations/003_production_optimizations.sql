-- Migration: 003_production_optimizations
-- Production-grade performance, security, auditability, and integrity improvements.
-- All changes are backward-compatible with 001_initial_schema and 002_storage_buckets.
-- Run via: supabase db push

-- ─── 1. Foreign Key Indexes ───────────────────────────────────────────────────
-- grow_members has a composite PK (grow_id, user_id) which covers grow_id lookups,
-- but user_id alone has no index — needed for "all grows a user belongs to" queries.
create index idx_grow_members_grow_id on grow_members(grow_id);
create index idx_grow_members_user_id on grow_members(user_id);

-- plant_observations.user_id: no index; needed for per-user activity feeds.
create index idx_plant_observations_user_id on plant_observations(user_id);

-- plant_findings.image_id: FK with no index; needed for image → findings joins.
create index idx_plant_findings_image_id on plant_findings(image_id);

-- chat_threads.grow_id: FK with no index; needed for grow → threads lookups.
create index idx_chat_threads_grow_id on chat_threads(grow_id);

-- ─── 2. Composite Indexes ─────────────────────────────────────────────────────
-- Timeline queries: latest images per grow (replaces single-column idx_plant_images_taken_at).
-- The existing idx_plant_images_taken_at is kept for backward compatibility with
-- any queries that sort globally; this composite index accelerates the common
-- "latest N images for a specific grow" pattern.
create index idx_plant_images_grow_id_taken_at on plant_images(grow_id, taken_at desc);

-- Alert queries: critical findings per plant (extends existing idx_plant_findings_plant_id).
create index idx_plant_findings_plant_id_severity on plant_findings(plant_id, severity);

-- Dashboard: user's recent activity across grows.
create index idx_grow_events_user_id_occurred_at on grow_events(user_id, occurred_at desc);

-- Plant timeline: latest observations per plant.
create index idx_plant_observations_plant_id_observed_at on plant_observations(plant_id, observed_at desc);

-- Chat: thread messages in chronological order (supersedes single-column indexes
-- idx_chat_messages_thread_id and idx_chat_messages_created_at for this access pattern).
create index idx_chat_messages_thread_id_created_at on chat_messages(thread_id, created_at asc);

-- ─── 3. Audit Columns & Triggers ─────────────────────────────────────────────
-- Track who created and last modified each mutable record.
-- created_by is nullable to avoid breaking existing rows on migration.

-- grows
alter table grows add column created_by uuid references auth.users(id);
alter table grows add column updated_by uuid references auth.users(id);

-- plants
alter table plants add column created_by uuid references auth.users(id);
alter table plants add column updated_by uuid references auth.users(id);

-- plant_observations (already has user_id for the author; updated_by tracks edits)
alter table plant_observations add column updated_by uuid references auth.users(id);

-- grow_events (already has user_id for the author; updated_by tracks edits)
alter table grow_events add column updated_by uuid references auth.users(id);

-- Trigger function: auto-populate created_by on INSERT, updated_by on INSERT/UPDATE.
-- Uses auth.uid() so it works transparently with Supabase RLS sessions.
create or replace function set_audit_columns()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
    new.updated_by = auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by = auth.uid();
  end if;
  return new;
end;
$$;

-- Apply audit triggers (BEFORE so the values are set before the row is written).
create trigger trg_grows_audit
  before insert or update on grows
  for each row execute function set_audit_columns();

create trigger trg_plants_audit
  before insert or update on plants
  for each row execute function set_audit_columns();

create trigger trg_plant_observations_audit
  before insert or update on plant_observations
  for each row execute function set_audit_columns();

create trigger trg_grow_events_audit
  before insert or update on grow_events
  for each row execute function set_audit_columns();

-- ─── 4. Unique Constraints ────────────────────────────────────────────────────
-- Prevent duplicate plant names within the same grow.
alter table plants
  add constraint unique_plant_name_per_grow unique(grow_id, name);

-- Prevent duplicate display names across profiles only when a name is set.
create unique index if not exists idx_profiles_display_name_unique
  on profiles(display_name)
  where display_name is not null;

-- ─── 5. Soft Delete Enforcement (RLS) ────────────────────────────────────────
-- Archived grows and plants are excluded from default SELECT policies.
-- Owners can still access archived records via the existing "owner write" policy
-- (which uses `for all`) or by querying with the service role.

-- grows: exclude archived records from member reads.
drop policy "grows: member read" on grows;
create policy "grows: member read"
  on grows for select
  using (
    (is_archived = false)
    and (
      auth.uid() = owner_id
      or exists (
        select 1 from grow_members gm
        where gm.grow_id = grows.id and gm.user_id = auth.uid()
      )
    )
  );

-- plants: exclude archived records from member reads.
drop policy "plants: grow member read" on plants;
create policy "plants: grow member read"
  on plants for select
  using (
    (is_archived = false)
    and exists (
      select 1 from grows g
      left join grow_members gm on gm.grow_id = g.id
      where g.id = plants.grow_id
        and (g.owner_id = auth.uid() or gm.user_id = auth.uid())
    )
  );

-- ─── 6. pgvector Extension & Semantic Search ─────────────────────────────────
-- Enables AI-powered similarity search over plant findings.
create extension if not exists "vector";

-- 1536-dimensional embeddings (OpenAI text-embedding-3-small / ada-002 compatible).
alter table plant_findings add column embedding vector(1536);

-- IVFFlat index for approximate nearest-neighbour search using cosine distance.
-- lists = 100 is appropriate for tables up to ~1 M rows; tune upward as data grows.
-- NOTE: populate embeddings before this index is useful; building on an empty
--       column is harmless but the index will be rebuilt on first VACUUM ANALYZE.
create index idx_plant_findings_embedding
  on plant_findings using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ─── 7. Storage Policy Hardening ─────────────────────────────────────────────
-- Replace the permissive "any authenticated user can upload" policy with one that
-- validates the uploader is the grow owner for the target plant.
--
-- Expected storage path structure: {plantId}/{filename}
-- (storage.foldername(name))[1] extracts the first path segment = plantId.

drop policy "plant-images: authenticated upload" on storage.objects;

create policy "plant-images: owner upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'plant-images'
    and auth.role() = 'authenticated'
    and exists (
      select 1 from plants p
      join grows g on g.id = p.grow_id
      where g.owner_id = auth.uid()
        and p.id::text = (storage.foldername(name))[1]
    )
  );

-- ─── 8. Chat Metadata Validation ─────────────────────────────────────────────
-- Enforce that metadata, when present, is a JSON object containing at least one
-- of the recognised keys: tokens, model, context.
-- This prevents arbitrary blobs from being stored and documents the expected shape.
alter table chat_messages
  add constraint valid_metadata check (
    metadata is null
    or (
      jsonb_typeof(metadata) = 'object'
      and (metadata ? 'tokens' or metadata ? 'model' or metadata ? 'context')
    )
  );

-- ─── 9. Batch Operation Indexes (Dashboard Performance) ───────────────────────
-- Partial indexes on non-archived rows only — smaller, faster, and self-documenting.

-- User's active grows sorted by most recently updated (dashboard "My Grows" list).
create index idx_grows_owner_id_updated_at
  on grows(owner_id, updated_at desc)
  where is_archived = false;

-- Active plants per grow sorted by most recently updated (grow detail page).
create index idx_plants_grow_id_updated_at
  on plants(grow_id, updated_at desc)
  where is_archived = false;
