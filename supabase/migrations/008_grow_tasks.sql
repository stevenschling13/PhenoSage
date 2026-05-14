-- Migration: 008_grow_tasks
--
-- Closes the loop on "AI does everything else": when the analysis service
-- writes a high- or critical-severity finding, an actionable task is created
-- automatically and surfaced to the grower (and the chat copilot) without
-- them having to read the raw finding first.
--
-- Data model:
--   grow_tasks is a per-grow worklist. Each task may be linked to the
--   plant_findings row that spawned it (via finding_id, unique → 1:1) so
--   the AI can cross-reference a task with the diagnostic evidence behind
--   it. Tasks created manually (by the grower or the chat tool) leave
--   finding_id NULL.
--
-- Auto-creation:
--   AFTER INSERT trigger on plant_findings inspects the new row's severity
--   and, when high or critical, inserts a task with priority derived from
--   severity. ON CONFLICT (finding_id) DO NOTHING keeps re-inserts idempotent
--   in the unlikely case the analysis service retries.
--
-- Safety posture:
--   * SELECT: any grow member (owner / collaborator / viewer).
--   * INSERT / UPDATE: owner or collaborator (viewers stay read-only).
--   * DELETE: owner only.
--   * Trigger runs SECURITY DEFINER so it works regardless of whether the
--     parent INSERT was service-role (analysis service) or, in the future,
--     a user-side call.
--
-- Rollback (do NOT run unless explicitly approved):
--   drop trigger if exists plant_findings_auto_task_trigger on plant_findings;
--   drop function if exists plant_findings_auto_task();
--   drop table if exists grow_tasks;
--   drop type if exists task_status;
--   drop type if exists task_priority;

-- ─── Enum types ───────────────────────────────────────────────────────────────
create type task_priority as enum ('low', 'medium', 'high', 'urgent');
create type task_status   as enum ('open', 'in_progress', 'done', 'dismissed');

-- ─── grow_tasks ───────────────────────────────────────────────────────────────
create table grow_tasks (
  id           uuid primary key default gen_random_uuid(),
  grow_id      uuid not null references grows(id) on delete cascade,
  plant_id     uuid references plants(id) on delete set null,
  -- One task per finding at most. NULL when the task was created manually.
  finding_id   uuid unique references plant_findings(id) on delete set null,
  title        text not null,
  description  text,
  priority     task_priority not null default 'medium',
  status       task_status   not null default 'open',
  due_at       timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);

alter table grow_tasks enable row level security;

create policy "grow_tasks: grow member read"
  on grow_tasks for select
  using (
    exists (
      select 1 from grows g
      left join grow_members gm
        on gm.grow_id = g.id and gm.user_id = auth.uid()
      where g.id = grow_tasks.grow_id
        and (g.owner_id = auth.uid() or gm.user_id = auth.uid())
    )
  );

create policy "grow_tasks: contributor insert"
  on grow_tasks for insert
  with check (
    exists (
      select 1 from grows g
      left join grow_members gm
        on gm.grow_id = g.id and gm.user_id = auth.uid()
      where g.id = grow_tasks.grow_id
        and (
          g.owner_id = auth.uid()
          or gm.role in ('owner', 'collaborator')
        )
    )
  );

create policy "grow_tasks: contributor update"
  on grow_tasks for update
  using (
    exists (
      select 1 from grows g
      left join grow_members gm
        on gm.grow_id = g.id and gm.user_id = auth.uid()
      where g.id = grow_tasks.grow_id
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
      where g.id = grow_tasks.grow_id
        and (
          g.owner_id = auth.uid()
          or gm.role in ('owner', 'collaborator')
        )
    )
  );

create policy "grow_tasks: owner delete"
  on grow_tasks for delete
  using (
    exists (
      select 1 from grows g
      where g.id = grow_tasks.grow_id and g.owner_id = auth.uid()
    )
  );

-- ─── updated_at auto-touch ────────────────────────────────────────────────────
create or replace function grow_tasks_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  -- Stamp completed_at the first time status transitions into a terminal state.
  if new.status in ('done', 'dismissed') and old.status not in ('done', 'dismissed') then
    new.completed_at := now();
  elsif new.status not in ('done', 'dismissed') then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger grow_tasks_touch_updated_at_trigger
  before update on grow_tasks
  for each row
  execute function grow_tasks_touch_updated_at();

-- ─── Auto-task-from-finding trigger ───────────────────────────────────────────
-- Fires AFTER INSERT on plant_findings. High and critical findings spawn an
-- open task; lower-severity findings do not (the chat / UI can still create
-- tasks manually via the contributor INSERT policy). The trigger runs as
-- SECURITY DEFINER so it works whether the parent insert was a user (future)
-- or the service role (today).
create or replace function plant_findings_auto_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.severity not in ('high', 'critical') then
    return new;
  end if;

  insert into grow_tasks (
    grow_id, plant_id, finding_id,
    title, description, priority, status
  ) values (
    new.grow_id,
    new.plant_id,
    new.id,
    'Address: ' || new.title,
    coalesce(new.recommendation, new.description),
    case
      when new.severity = 'critical' then 'urgent'::task_priority
      else 'high'::task_priority
    end,
    'open'::task_status
  )
  on conflict (finding_id) do nothing;

  return new;
end;
$$;

create trigger plant_findings_auto_task_trigger
  after insert on plant_findings
  for each row
  execute function plant_findings_auto_task();

-- ─── Indexes ──────────────────────────────────────────────────────────────────
-- Most queries scope by grow + status (the "what's open in tent A?" pattern).
create index idx_grow_tasks_grow_status
  on grow_tasks(grow_id, status);

-- Plant-scoped task lookups for the plant detail page.
create index idx_grow_tasks_plant_id
  on grow_tasks(plant_id)
  where plant_id is not null;

-- Cross-reference from a finding to its task (rare but useful for ops).
create index idx_grow_tasks_finding_id
  on grow_tasks(finding_id)
  where finding_id is not null;
