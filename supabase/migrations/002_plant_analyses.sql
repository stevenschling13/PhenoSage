-- Migration: 002_plant_analyses
-- Adds a dedicated table to persist a snapshot of each AI analysis response
-- so the "latest analysis" endpoint can return real data without re-calling
-- the AI service, and the UI can render the full response (summary, score,
-- comparison) without reassembling it from plant_findings.

create table plant_analyses (
  id                      uuid primary key default gen_random_uuid(),
  plant_id                uuid not null references plants(id) on delete cascade,
  grow_id                 uuid not null references grows(id) on delete cascade,
  image_id                uuid not null references plant_images(id) on delete cascade,
  overall_health_score    numeric(5, 2) not null check (
    overall_health_score >= 0 and overall_health_score <= 100
  ),
  summary                 text not null,
  compared_to_image_id    uuid references plant_images(id) on delete set null,
  comparison_summary      text,
  model_version           text not null,
  analyzed_at             timestamptz not null,
  created_at              timestamptz not null default now()
);

alter table plant_analyses enable row level security;

create policy "plant_analyses: grow member read"
  on plant_analyses for select
  using (
    exists (
      select 1 from grows g
      left join grow_members gm on gm.grow_id = g.id
      where g.id = plant_analyses.grow_id
        and (g.owner_id = auth.uid() or gm.user_id = auth.uid())
    )
  );

-- Writes come from the service role only (Next.js route handlers).
-- No user-facing insert policy.

create index idx_plant_analyses_plant_id on plant_analyses(plant_id);
create index idx_plant_analyses_image_id on plant_analyses(image_id);
create index idx_plant_analyses_analyzed_at on plant_analyses(analyzed_at desc);
