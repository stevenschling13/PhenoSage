-- Migration: 019_pg_trgm_search
--
-- Installs pg_trgm and adds GIN trigram indexes on the columns the chat
-- agent's find_grow / find_plant tools currently scan with ILIKE
-- (see PR #143). Drop-in speedup: PostgREST `.ilike()` queries
-- transparently pick up GIN trigram indexes, so even without code
-- changes ILIKE goes from full-scan to index-lookup at scale (~60-80ms
-- for fuzzy substring on multi-million-row tables per pg_trgm docs).
--
-- This migration also exposes two SECURITY INVOKER RPCs —
-- `search_grows` and `search_plants` — that rank results by trigram
-- similarity instead of substring match alone. The RPCs run as the
-- calling role, so RLS policies on `grows` and `plants` apply
-- unmodified (a viewer can't surface another user's rows via the RPC).
--
-- # Why pg_trgm vs full-text-search
--
--   * Plant + grow names are typically short labels ("North Tent",
--     "Plant 03", "OG Kush #2") — not prose. Full-text search shines
--     on tokenised prose; trigrams shine on short fuzzy substrings,
--     misspellings, and partial matches.
--   * pg_trgm `%` operator and `similarity()` provide a single
--     similarity score we can rank by; FTS needs `ts_rank_cd` plus
--     a tsvector column.
--   * pg_trgm needs no extra column (operates directly on the text
--     column), so no rewrite of insert paths.
--
-- # Safety posture
--
--   * Extension lives in `extensions` schema, consistent with
--     migration 013 for pgvector. Roles already have `extensions` in
--     search_path so unqualified `similarity()` resolves.
--   * Indexes are `IF NOT EXISTS` — re-running the migration is a
--     no-op. CONCURRENTLY is intentionally NOT used because Supabase
--     migrations run inside a transaction; expected row counts are
--     small (per-user dozens of grows, hundreds of plants).
--   * RPCs are SECURITY INVOKER with locked search_path. RLS
--     policies on the underlying tables enforce ownership. The RPCs
--     return only public columns already exposed by the existing
--     read tools.
--   * `pg_trgm.similarity_threshold` is left at the default (0.3).
--     The `%` operator uses it for the candidate filter; the RPC
--     also accepts a substring fallback so single-character or
--     diacritic-stripped queries still resolve.
--
-- # Rollback (do NOT run unless explicitly approved)
--
--   drop function if exists public.search_grows(text, boolean, int);
--   drop function if exists public.search_plants(text, uuid, boolean, int);
--   drop index if exists idx_grows_name_trgm;
--   drop index if exists idx_grows_description_trgm;
--   drop index if exists idx_plants_name_trgm;
--   drop index if exists idx_plants_strain_trgm;
--   drop index if exists idx_plants_batch_label_trgm;
--   -- Leave the extension installed; other tooling may rely on it.

-- ─── 1. Install pg_trgm in extensions schema ─────────────────────────

create extension if not exists pg_trgm with schema extensions;

-- ─── 2. GIN trigram indexes on hot search columns ────────────────────
-- `gin_trgm_ops` is the GIN operator class shipped by pg_trgm; it
-- accelerates ILIKE, LIKE, ~*, ~ on the indexed column. Partial
-- indexes skip archived rows because the chat tools default to
-- `is_archived = false`; archived rows still match via sequential
-- scan if `includeArchived = true` is passed.

create index if not exists idx_grows_name_trgm
  on public.grows using gin (name extensions.gin_trgm_ops)
  where is_archived = false;

create index if not exists idx_grows_description_trgm
  on public.grows using gin (description extensions.gin_trgm_ops)
  where is_archived = false and description is not null;

create index if not exists idx_plants_name_trgm
  on public.plants using gin (name extensions.gin_trgm_ops)
  where is_archived = false;

create index if not exists idx_plants_strain_trgm
  on public.plants using gin (strain extensions.gin_trgm_ops)
  where is_archived = false and strain is not null;

create index if not exists idx_plants_batch_label_trgm
  on public.plants using gin (batch_label extensions.gin_trgm_ops)
  where is_archived = false and batch_label is not null;

-- ─── 3. search_grows RPC — trigram-ranked find ───────────────────────
-- Returns up to `max_results` grows ordered by similarity score.
-- The candidate set is the union of:
--   * substring match (ilike '%q%') — preserves the old behavior so
--     single-character / very short queries still resolve
--   * trigram match (% operator, threshold 0.3 by default) — catches
--     misspellings + reorderings ("nort tnt" → "North Tent")
-- Ranking favors name matches over description matches (0.7x weight).

create or replace function public.search_grows(
  q text,
  include_archived boolean default false,
  max_results int default 5
)
returns table (
  id uuid,
  name text,
  description text,
  stage text,
  medium text,
  light_type text,
  start_date date,
  is_archived boolean,
  updated_at timestamptz,
  match_score real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q_input as (
    select trim(coalesce(q, '')) as qt
  ), candidates as (
    select g.id, g.name, g.description, g.stage::text, g.medium::text,
           g.light_type::text, g.start_date, g.is_archived, g.updated_at,
           greatest(
             extensions.similarity(g.name, (select qt from q_input)),
             coalesce(
               extensions.similarity(g.description, (select qt from q_input)) * 0.7,
               0
             )
           )::real as match_score
    from public.grows g, q_input
    where (include_archived or g.is_archived = false)
      and length(q_input.qt) > 0
      and (
        g.name ilike '%' || q_input.qt || '%'
        or g.description ilike '%' || q_input.qt || '%'
        or g.name operator(extensions.%) q_input.qt
        or coalesce(g.description, '') operator(extensions.%) q_input.qt
      )
  )
  select * from candidates
  order by match_score desc, updated_at desc
  limit greatest(1, least(coalesce(max_results, 5), 25));
$$;

-- ─── 4. search_plants RPC — trigram-ranked find ──────────────────────
-- Optional grow_id scope so the agent can narrow to a single grow.

create or replace function public.search_plants(
  q text,
  scope_grow_id uuid default null,
  include_archived boolean default false,
  max_results int default 5
)
returns table (
  id uuid,
  grow_id uuid,
  name text,
  strain text,
  batch_label text,
  notes text,
  is_archived boolean,
  updated_at timestamptz,
  match_score real
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q_input as (
    select trim(coalesce(q, '')) as qt
  ), candidates as (
    select p.id, p.grow_id, p.name, p.strain, p.batch_label, p.notes,
           p.is_archived, p.updated_at,
           greatest(
             extensions.similarity(p.name, (select qt from q_input)),
             coalesce(
               extensions.similarity(p.strain, (select qt from q_input)) * 0.8,
               0
             ),
             coalesce(
               extensions.similarity(p.batch_label, (select qt from q_input)) * 0.7,
               0
             )
           )::real as match_score
    from public.plants p, q_input
    where (scope_grow_id is null or p.grow_id = scope_grow_id)
      and (include_archived or p.is_archived = false)
      and length(q_input.qt) > 0
      and (
        p.name ilike '%' || q_input.qt || '%'
        or p.strain ilike '%' || q_input.qt || '%'
        or p.batch_label ilike '%' || q_input.qt || '%'
        or p.name operator(extensions.%) q_input.qt
        or coalesce(p.strain, '') operator(extensions.%) q_input.qt
        or coalesce(p.batch_label, '') operator(extensions.%) q_input.qt
      )
  )
  select * from candidates
  order by match_score desc, updated_at desc
  limit greatest(1, least(coalesce(max_results, 5), 25));
$$;

-- Grants — PostgREST honors these for `.rpc()` callability. Without
-- the grant, anon/authenticated get "function … does not exist".
grant execute on function public.search_grows(text, boolean, int)
  to authenticated, service_role;
grant execute on function public.search_plants(text, uuid, boolean, int)
  to authenticated, service_role;
