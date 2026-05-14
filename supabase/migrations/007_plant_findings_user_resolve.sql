-- Migration: 007_plant_findings_user_resolve
--
-- Lets a grow owner or collaborator mark an AI-generated finding as resolved
-- (or unresolve it) from the app — previously the chat tool / UI had no way
-- to touch plant_findings because the original schema only granted SELECT to
-- grow members, leaving writes to the service role.
--
-- Safety posture:
--   * RLS UPDATE policy is scoped to owner + collaborator (viewers stay read-only).
--   * A BEFORE UPDATE trigger restricts user-initiated changes to the
--     `resolved_at` column only, so a user opening their browser console and
--     calling supabase.from('plant_findings').update({ severity: 'low' }) is
--     rejected even though they are a grow member. Service role (the AI
--     analysis service, daily cron, anything authenticated without a JWT)
--     bypasses the trigger so it can still overwrite findings.
--   * No data migration — existing rows are unaffected; only future UPDATE
--     calls hit the new policy + trigger.
--
-- Rollback (do NOT run unless explicitly approved):
--   drop trigger if exists plant_findings_user_update_guard_trigger on plant_findings;
--   drop function if exists plant_findings_user_update_guard();
--   drop policy if exists "plant_findings: grow contributor resolve" on plant_findings;

-- ─── UPDATE policy ────────────────────────────────────────────────────────────
-- Mirrors the SELECT policy's grow-membership check but restricts to roles
-- that can contribute (owner, collaborator). Viewers remain read-only.
create policy "plant_findings: grow contributor resolve"
  on plant_findings for update
  using (
    exists (
      select 1 from grows g
      left join grow_members gm
        on gm.grow_id = g.id and gm.user_id = auth.uid()
      where g.id = plant_findings.grow_id
        and (
          g.owner_id = auth.uid()
          or gm.role in ('owner', 'collaborator')
        )
    )
  )
  with check (
    exists (
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

-- ─── Column-restriction trigger ───────────────────────────────────────────────
-- Authoritative source for "users may only change resolved_at on plant_findings".
-- Triggers fire AFTER RLS, so by the time we get here we already know the row
-- is accessible to this user. We only need to validate which columns changed.
--
-- auth.uid() returns NULL when the request is made with the service role key
-- (no Supabase JWT context), so we skip the guard for service-role traffic —
-- that's how the analysis service inserts/refreshes findings.
create or replace function plant_findings_user_update_guard()
returns trigger
language plpgsql
security invoker  -- run as the caller; we explicitly check auth.uid() below
as $$
begin
  if auth.uid() is null then
    -- Service role / no-JWT context: trust the caller (it's our own server code).
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
     or new.created_at  is distinct from old.created_at
  then
    raise exception 'plant_findings: only resolved_at may be modified by users'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger plant_findings_user_update_guard_trigger
  before update on plant_findings
  for each row
  execute function plant_findings_user_update_guard();
