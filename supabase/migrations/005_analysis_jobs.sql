-- Migration: 005_analysis_jobs
-- Purpose: durable async analysis job queue and idempotent enqueue RPC

create table if not exists analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references plants(id) on delete cascade,
  image_id uuid not null references plant_images(id) on delete cascade,
  grow_id uuid not null references grows(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('queued','running','succeeded','failed','retrying','cancelled')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts > 0),
  idempotency_key text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  error_code text,
  error_message text,
  result_analysis_id uuid references plant_analyses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_analysis_jobs_status_queued_at
  on analysis_jobs(status, queued_at);
create index if not exists idx_analysis_jobs_status_next_attempt_at
  on analysis_jobs(status, next_attempt_at);
create index if not exists idx_analysis_jobs_image_id
  on analysis_jobs(image_id);
create index if not exists idx_analysis_jobs_plant_id_queued_at_desc
  on analysis_jobs(plant_id, queued_at desc);
create unique index if not exists idx_analysis_jobs_image_idem
  on analysis_jobs(image_id, idempotency_key)
  where idempotency_key is not null;

alter table analysis_jobs enable row level security;

create policy "analysis_jobs: grow member read"
  on analysis_jobs for select
  using (
    exists (
      select 1 from grow_collaborators gc
      where gc.grow_id = analysis_jobs.grow_id
        and gc.user_id = auth.uid()
    )
  );

create or replace function set_analysis_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_analysis_jobs_updated_at on analysis_jobs;
create trigger trg_analysis_jobs_updated_at
  before update on analysis_jobs
  for each row execute procedure set_analysis_jobs_updated_at();

grant select on analysis_jobs to authenticated;

create or replace function enqueue_analysis_job(
  p_plant_id uuid,
  p_image_id uuid,
  p_grow_id uuid,
  p_requested_by uuid,
  p_idempotency_key text default null,
  p_max_attempts integer default 3
)
returns analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job analysis_jobs;
begin
  if p_idempotency_key is not null then
    select * into v_job
    from analysis_jobs
    where image_id = p_image_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return v_job;
    end if;
  end if;

  insert into analysis_jobs (
    plant_id,
    image_id,
    grow_id,
    requested_by,
    status,
    idempotency_key,
    max_attempts
  ) values (
    p_plant_id,
    p_image_id,
    p_grow_id,
    p_requested_by,
    'queued',
    p_idempotency_key,
    coalesce(nullif(p_max_attempts, 0), 3)
  )
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function enqueue_analysis_job(uuid, uuid, uuid, uuid, text, integer) to authenticated;
