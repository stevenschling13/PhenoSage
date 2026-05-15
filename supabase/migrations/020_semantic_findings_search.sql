-- Migration: 020_semantic_findings_search
-- Purpose:   Add server-populated finding embedding metadata and an RLS-scoped
--            RPC for active-grow semantic retrieval over historical findings.
-- Writers:   `embedding` and `embedding_content_hash` are written by the
--            Next.js server with the service role after a finding is created.
-- Rollback:  revoke execute on function public.match_similar_grow_findings(uuid, vector(1536), integer, double precision, uuid[]) from authenticated, service_role;
--            drop function if exists public.match_similar_grow_findings(uuid, vector(1536), integer, double precision, uuid[]);
--            alter table public.plant_findings drop column if exists embedding_content_hash;
--            restore the previous plant_findings_user_update_guard() body from migration 010.

begin;

alter table public.plant_findings
  add column if not exists embedding_content_hash text;

create index if not exists idx_plant_findings_embedding_content_hash
  on public.plant_findings(embedding_content_hash)
  where embedding_content_hash is not null;

-- Keep contributor updates restricted to resolved_at. Migration 007/010
-- predated semantic retrieval; include both the existing vector column and the
-- new content hash so browser-side clients cannot tamper with retrieval data.
create or replace function public.plant_findings_user_update_guard()
returns trigger
language plpgsql
security invoker
as $$
begin
  if auth.uid() is null then
    -- Service role / no-JWT context: trust the caller (our own server code).
    return new;
  end if;

  if new.plant_id       is distinct from old.plant_id
     or new.grow_id     is distinct from old.grow_id
     or new.image_id    is distinct from old.image_id
     or new.category    is distinct from old.category
     or new.severity    is distinct from old.severity
     or new.title       is distinct from old.title
     or new.description is distinct from old.description
     or new.recommendation is distinct from old.recommendation
     or new.source      is distinct from old.source
     or new.created_at  is distinct from old.created_at
     or new.embedding::text is distinct from old.embedding::text
     or new.embedding_content_hash is distinct from old.embedding_content_hash
  then
    raise exception 'plant_findings: only resolved_at may be modified by users'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.match_similar_grow_findings(
  p_grow_id uuid,
  p_query_embedding vector(1536),
  p_match_count integer default 5,
  p_match_threshold double precision default 0.72,
  p_exclude_finding_ids uuid[] default '{}'
)
returns table (
  id uuid,
  plant_id uuid,
  plant_name text,
  category finding_category,
  severity finding_severity,
  title text,
  description text,
  recommendation text,
  source text,
  created_at timestamptz,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with nearest as materialized (
    select
      pf.id,
      pf.plant_id,
      p.name as plant_name,
      pf.category,
      pf.severity,
      pf.title,
      pf.description,
      pf.recommendation,
      pf.source,
      pf.created_at,
      1 - (pf.embedding <=> p_query_embedding) as similarity,
      pf.embedding <=> p_query_embedding as distance
    from public.plant_findings pf
    join public.plants p on p.id = pf.plant_id
    where pf.grow_id = p_grow_id
      and pf.embedding is not null
      and not (pf.id = any(coalesce(p_exclude_finding_ids, '{}')))
    order by pf.embedding <=> p_query_embedding
    limit least(greatest(coalesce(p_match_count, 5), 1), 20)
  )
  select
    nearest.id,
    nearest.plant_id,
    nearest.plant_name,
    nearest.category,
    nearest.severity,
    nearest.title,
    nearest.description,
    nearest.recommendation,
    nearest.source,
    nearest.created_at,
    nearest.similarity
  from nearest
  where nearest.similarity >= coalesce(p_match_threshold, 0.72)
  order by nearest.distance
  limit least(greatest(coalesce(p_match_count, 5), 1), 20);
$$;

revoke execute on function public.match_similar_grow_findings(uuid, vector(1536), integer, double precision, uuid[]) from public;
revoke execute on function public.match_similar_grow_findings(uuid, vector(1536), integer, double precision, uuid[]) from anon;
grant execute on function public.match_similar_grow_findings(uuid, vector(1536), integer, double precision, uuid[]) to authenticated, service_role;

commit;
