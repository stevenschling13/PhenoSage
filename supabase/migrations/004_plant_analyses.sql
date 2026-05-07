-- Migration: 004_plant_analyses
-- Persist normalized analysis runs separately from findings so timeline/latest-analysis
-- routes can return one stable record per image and clearly flag fallback output.

create table if not exists plant_analyses (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references plants(id) on delete cascade,
  grow_id uuid not null references grows(id) on delete cascade,
  image_id uuid not null unique references plant_images(id) on delete cascade,
  compared_to_image_id uuid references plant_images(id) on delete set null,
  overall_health_score numeric(5, 1) not null,
  summary text not null,
  comparison_summary text,
  analyzed_at timestamptz not null default now(),
  model_version text not null,
  analysis_mode text not null check (analysis_mode in ('model', 'fallback')),
  is_fallback boolean not null default false,
  fallback_reason text,
  request_id text,
  created_at timestamptz not null default now()
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

create index if not exists idx_plant_analyses_plant_id_analyzed_at
  on plant_analyses(plant_id, analyzed_at desc);

create index if not exists idx_plant_analyses_image_id
  on plant_analyses(image_id);
