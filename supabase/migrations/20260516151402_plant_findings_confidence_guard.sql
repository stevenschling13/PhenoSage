-- Migration: plant_findings_confidence_guard
-- Purpose:   Keep contributor updates restricted to resolved_at after adding
--            plant_findings.confidence_score for service-role analysis writes.
-- Writers:   No table data is written by this migration. It only replaces the
--            plant_findings_user_update_guard() trigger function.
-- Rollback:  restore the plant_findings_user_update_guard() body from migration 020.

begin;

create or replace function public.plant_findings_user_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
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
     or new.confidence_score is distinct from old.confidence_score
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

commit;
