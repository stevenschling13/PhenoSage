-- Migration: plant_findings_resolution_state
--
-- Adds a "confidence ledger" to plant_findings so a grow owner or
-- collaborator can confirm, reject, or mark-as-false-positive an AI
-- finding from the app. Previously the only user-side state on a
-- finding was `resolved_at`, which conflates two distinct outcomes:
-- "the issue is real and I fixed it" vs "the AI was wrong, please
-- learn from this." Keeping them separate gives us the supervised
-- signal we need for future fine-tuning and lets the chat copilot
-- weight historical findings by user trust instead of treating every
-- AI finding as ground truth.
--
-- Data model:
--   * resolution_state text + check  — default 'pending'. Values:
--       pending         — no user action taken yet (default).
--       confirmed       — user agrees the AI was right.
--       rejected        — user disagrees: the issue is not present.
--       false_positive  — user disagrees AND wants to flag this as
--                         training data (UI synonym for rejected with
--                         a stronger "the model was wrong" signal).
--   * resolution_note text  — optional free-text reason. Capped at
--     2000 chars by check to keep storage bounded; UI will enforce
--     a shorter limit (~500) for readability.
--
-- Auto-dismiss linked task:
--   When resolution_state flips to 'rejected' or 'false_positive', any
--   grow_task spawned from this finding (via migration 008's
--   plant_findings_auto_task trigger) is moved to status='dismissed'
--   IFF it is currently 'open' or 'in_progress'. Tasks already marked
--   'done' are left alone (the user explicitly completed them — they
--   shouldn't get retroactively dismissed) and tasks already
--   'dismissed' are no-ops. This closes the loop from "user marks
--   finding wrong" → "the work item it created disappears" without
--   touching unrelated work.
--
-- Safety posture:
--   * SELECT: unchanged (grow members read).
--   * UPDATE: extends the existing user_update_guard to add
--     resolution_state and resolution_note to the writable column set
--     alongside resolved_at. All other column changes remain blocked
--     for non-service-role callers.
--   * RLS UPDATE policy (migration 007) already restricts UPDATE to
--     owner + collaborator, so viewers cannot mutate the ledger.
--   * The auto-dismiss trigger runs SECURITY DEFINER so it can update
--     grow_tasks even when the parent UPDATE was a user (whose RLS
--     would normally only let them update the finding row, not the
--     task — but since the task and finding share the same grow, and
--     RLS already gates writes on grow membership, this is the same
--     authorization envelope expressed at trigger level).
--
-- Rollback (do NOT run unless explicitly approved):
--   drop trigger if exists plant_findings_resolution_dismiss_task on plant_findings;
--   drop function if exists plant_findings_resolution_dismiss_task();
--   -- Restore the migration 20260516 guard body to drop resolution_* from the writable set.
--   alter table plant_findings drop column if exists resolution_note;
--   alter table plant_findings drop column if exists resolution_state;

begin;

-- ─── Columns ─────────────────────────────────────────────────────────────────
alter table public.plant_findings
  add column if not exists resolution_state text not null default 'pending'
    check (resolution_state in ('pending', 'confirmed', 'rejected', 'false_positive'));

alter table public.plant_findings
  add column if not exists resolution_note text
    check (resolution_note is null or char_length(resolution_note) <= 2000);

-- ─── Extend the column-restriction guard ─────────────────────────────────────
-- Mirrors the migration 20260516 guard and adds resolution_state +
-- resolution_note to the writable-by-users column set. Service role
-- (auth.uid() is null) keeps bypassing the guard.
create or replace function public.plant_findings_user_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.plant_id              is distinct from old.plant_id
     or new.grow_id            is distinct from old.grow_id
     or new.image_id           is distinct from old.image_id
     or new.category           is distinct from old.category
     or new.severity           is distinct from old.severity
     or new.title              is distinct from old.title
     or new.description        is distinct from old.description
     or new.recommendation     is distinct from old.recommendation
     or new.source             is distinct from old.source
     or new.confidence_score   is distinct from old.confidence_score
     or new.created_at         is distinct from old.created_at
     or new.embedding::text    is distinct from old.embedding::text
     or new.embedding_content_hash is distinct from old.embedding_content_hash
  then
    raise exception 'plant_findings: only resolved_at, resolution_state, resolution_note may be modified by users'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ─── Auto-dismiss linked task on rejection ──────────────────────────────────
-- Closes the loop: when a user marks a finding as rejected or false_positive,
-- the open task that the migration 008 auto-task trigger spawned is moved to
-- 'dismissed'. We only touch tasks linked to THIS finding (via finding_id)
-- and only when they're still actionable (open or in_progress) — done /
-- already-dismissed tasks are left alone so we never undo completed work.
create or replace function public.plant_findings_resolution_dismiss_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only fire on transitions INTO a dismissive state; idempotent re-saves
  -- with the same state are a no-op.
  if new.resolution_state is not distinct from old.resolution_state then
    return new;
  end if;

  if new.resolution_state not in ('rejected', 'false_positive') then
    return new;
  end if;

  update public.grow_tasks
     set status = 'dismissed'::task_status
   where finding_id = new.id
     and status in ('open', 'in_progress');

  return new;
end;
$$;

create trigger plant_findings_resolution_dismiss_task
  after update of resolution_state on public.plant_findings
  for each row
  execute function public.plant_findings_resolution_dismiss_task();

-- ─── Indexes ────────────────────────────────────────────────────────────────
-- Partial index on the unresolved-ledger entries (the "needs your review"
-- count on the dashboard). Most findings will sit in 'pending' until a user
-- touches them, so the partial keeps the index small and writes cheap.
create index if not exists idx_plant_findings_pending_resolution
  on public.plant_findings(grow_id, created_at desc)
  where resolution_state = 'pending';

commit;
