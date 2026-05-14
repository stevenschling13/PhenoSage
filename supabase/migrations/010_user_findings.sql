-- Migration: 010_user_findings
--
-- Lets a grow owner or collaborator file their own structured plant_findings
-- through the chat assistant (e.g. "I see early N deficiency on the lower
-- fans of plant 4"). Today the table is service-role-write-only by design,
-- so the AI analysis service is the only source of findings — this opens a
-- second source while preserving AI findings as ground-truth-by-default.
--
-- Data model:
--   * New column `source text not null default 'ai'` with a CHECK that
--     restricts values to ('ai', 'user_reported'). Existing rows backfill
--     to 'ai' automatically via the default. The analysis service can
--     keep inserting without touching this column.
--   * The auto-task trigger from migration 008 already runs SECURITY
--     DEFINER and is source-agnostic, so user_reported high/critical
--     findings spawn an open task in grow_tasks exactly like AI findings
--     do — no changes there.
--
-- Safety posture:
--   * SELECT: any grow member (unchanged from migration 001).
--   * UPDATE: owner + collaborator can still only flip resolved_at — the
--     BEFORE UPDATE guard from migration 007 is extended here to add
--     `source` to the immutable column list, so a user can't reclassify
--     an AI finding by flipping source to 'user_reported' or vice versa.
--     Service role still bypasses (auth.uid() is null path).
--   * INSERT: NEW policy "plant_findings: grow contributor user-report"
--     lets owner + collaborator insert rows where source = 'user_reported'
--     only. Viewers remain read-only. AI / service-role traffic bypasses
--     RLS entirely so the analysis service keeps inserting source='ai'
--     rows unaffected.
--
-- Rollback (do NOT run unless explicitly approved):
--   -- Restore the migration 007 guard signature first to drop the source check.
--   create or replace function plant_findings_user_update_guard()
--   returns trigger
--   language plpgsql
--   security invoker
--   as $$
--   begin
--     if auth.uid() is null then return new; end if;
--     if new.plant_id is distinct from old.plant_id
--        or new.grow_id is distinct from old.grow_id
--        or new.image_id is distinct from old.image_id
--        or new.category is distinct from old.category
--        or new.severity is distinct from old.severity
--        or new.title is distinct from old.title
--        or new.description is distinct from old.description
--        or new.recommendation is distinct from old.recommendation
--        or new.created_at is distinct from old.created_at
--     then
--       raise exception 'plant_findings: only resolved_at may be modified by users'
--         using errcode = '42501';
--     end if;
--     return new;
--   end;
--   $$;
--   drop policy if exists "plant_findings: grow contributor user-report" on plant_findings;
--   alter table plant_findings drop column if exists source;

-- ─── source column ────────────────────────────────────────────────────────────
-- text + check rather than a new enum so we can add future sources without a
-- second enum migration (cron-derived, third-party imports, etc.).
alter table plant_findings
  add column if not exists source text not null default 'ai'
    check (source in ('ai', 'user_reported'));

-- ─── INSERT policy (user-side) ────────────────────────────────────────────────
-- Owner + collaborator can insert their own findings, but only with the
-- 'user_reported' source. AI findings continue to land via service role
-- (which bypasses RLS).
create policy "plant_findings: grow contributor user-report"
  on plant_findings for insert
  with check (
    source = 'user_reported'
    and exists (
      select 1 from grows g
      left join grow_members gm
        on gm.grow_id = g.id and gm.user_id = auth.uid()
      where g.id = plant_findings.grow_id
        and (
          g.owner_id = auth.uid()
          or gm.role in ('owner', 'collaborator')
        )
    )
  );

-- ─── Extend the column-restriction trigger to cover `source` ─────────────────
-- Mirrors migration 007's guard but adds `source` to the immutable column
-- set so a contributor can't flip a finding's provenance after the fact.
-- Service role still bypasses via the auth.uid() is null path.
create or replace function plant_findings_user_update_guard()
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
  then
    raise exception 'plant_findings: only resolved_at may be modified by users'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
