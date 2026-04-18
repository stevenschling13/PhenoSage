-- Migration: 001_initial_schema
-- PhenoSage initial database schema
-- Run via: supabase db push

-- ─── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
-- pgvector ready — uncomment when enabling semantic search
-- create extension if not exists "vector";

-- ─── Enum types ───────────────────────────────────────────────────────────────
create type grow_stage as enum (
  'germination', 'seedling', 'vegetative', 'pre_flower',
  'flower', 'late_flower', 'harvest', 'dry_cure'
);

create type grow_medium as enum (
  'soil', 'coco', 'hydro', 'aero', 'living_soil', 'other'
);

create type light_type as enum (
  'hps', 'cmh', 'led', 't5', 'sun', 'mixed', 'other'
);

create type grow_role as enum ('owner', 'collaborator', 'viewer');

create type image_source as enum ('upload', 'camera');

create type finding_category as enum (
  'nutrient_deficiency', 'nutrient_toxicity', 'pest', 'disease',
  'environmental', 'training', 'general', 'positive'
);

create type finding_severity as enum ('info', 'low', 'medium', 'high', 'critical');

create type event_type as enum (
  'water', 'feed', 'top', 'fim', 'lst', 'defoliate',
  'transplant', 'ipm', 'harvest', 'observation', 'note', 'other'
);

create type message_role as enum ('user', 'assistant', 'system');

-- ─── profiles ─────────────────────────────────────────────────────────────────
-- Extends Supabase auth.users. Created automatically on user signup via trigger.
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table profiles enable row level security;

-- Users can read and update their own profile only
create policy "profiles: owner read"
  on profiles for select
  using (auth.uid() = id);

create policy "profiles: owner update"
  on profiles for update
  using (auth.uid() = id);

-- ─── grows ────────────────────────────────────────────────────────────────────
create table grows (
  id                  uuid primary key default uuid_generate_v4(),
  owner_id            uuid not null references auth.users(id) on delete cascade,
  name                text not null,
  description         text,
  stage               grow_stage not null default 'seedling',
  medium              grow_medium not null default 'soil',
  light_type          light_type not null default 'led',
  target_harvest_date date,
  start_date          date not null default current_date,
  is_archived         boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table grows enable row level security;

-- Owner + collaborators/viewers via grow_members
create policy "grows: member read"
  on grows for select
  using (
    auth.uid() = owner_id
    or exists (
      select 1 from grow_members gm
      where gm.grow_id = grows.id and gm.user_id = auth.uid()
    )
  );

create policy "grows: owner write"
  on grows for all
  using (auth.uid() = owner_id);

-- ─── grow_members ─────────────────────────────────────────────────────────────
create table grow_members (
  grow_id    uuid not null references grows(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       grow_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (grow_id, user_id)
);

alter table grow_members enable row level security;

create policy "grow_members: grow owner manage"
  on grow_members for all
  using (
    exists (
      select 1 from grows g
      where g.id = grow_members.grow_id and g.owner_id = auth.uid()
    )
  );

create policy "grow_members: self read"
  on grow_members for select
  using (user_id = auth.uid());

-- ─── plants ───────────────────────────────────────────────────────────────────
create table plants (
  id          uuid primary key default uuid_generate_v4(),
  grow_id     uuid not null references grows(id) on delete cascade,
  name        text not null,
  strain      text,
  batch_label text,
  notes       text,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table plants enable row level security;

create policy "plants: grow member read"
  on plants for select
  using (
    exists (
      select 1 from grows g
      left join grow_members gm on gm.grow_id = g.id
      where g.id = plants.grow_id
        and (g.owner_id = auth.uid() or gm.user_id = auth.uid())
    )
  );

create policy "plants: grow owner write"
  on plants for all
  using (
    exists (
      select 1 from grows g
      where g.id = plants.grow_id and g.owner_id = auth.uid()
    )
  );

-- ─── plant_images ─────────────────────────────────────────────────────────────
-- Images are stored in private Supabase Storage buckets.
-- storage_path is the Supabase Storage object path; signed URLs are generated server-side.
create table plant_images (
  id           uuid primary key default uuid_generate_v4(),
  plant_id     uuid not null references plants(id) on delete cascade,
  grow_id      uuid not null references grows(id) on delete cascade,
  user_id      uuid not null references auth.users(id),
  storage_path text not null,
  taken_at     timestamptz,
  source       image_source not null default 'upload',
  notes        text,
  created_at   timestamptz not null default now()
);

alter table plant_images enable row level security;

create policy "plant_images: grow member read"
  on plant_images for select
  using (
    exists (
      select 1 from grows g
      left join grow_members gm on gm.grow_id = g.id
      where g.id = plant_images.grow_id
        and (g.owner_id = auth.uid() or gm.user_id = auth.uid())
    )
  );

create policy "plant_images: uploader write"
  on plant_images for insert
  with check (user_id = auth.uid());

-- ─── plant_observations ───────────────────────────────────────────────────────
create table plant_observations (
  id          uuid primary key default uuid_generate_v4(),
  plant_id    uuid not null references plants(id) on delete cascade,
  grow_id     uuid not null references grows(id) on delete cascade,
  user_id     uuid not null references auth.users(id),
  observed_at timestamptz not null default now(),
  height_cm   numeric(6, 2),
  notes       text,
  created_at  timestamptz not null default now()
);

alter table plant_observations enable row level security;

create policy "plant_observations: grow member read"
  on plant_observations for select
  using (
    exists (
      select 1 from grows g
      left join grow_members gm on gm.grow_id = g.id
      where g.id = plant_observations.grow_id
        and (g.owner_id = auth.uid() or gm.user_id = auth.uid())
    )
  );

create policy "plant_observations: author write"
  on plant_observations for insert
  with check (user_id = auth.uid());

-- ─── plant_findings ───────────────────────────────────────────────────────────
-- AI-generated or manually recorded findings for a plant.
create table plant_findings (
  id             uuid primary key default uuid_generate_v4(),
  plant_id       uuid not null references plants(id) on delete cascade,
  grow_id        uuid not null references grows(id) on delete cascade,
  image_id       uuid references plant_images(id) on delete set null,
  category       finding_category not null,
  severity       finding_severity not null,
  title          text not null,
  description    text not null,
  recommendation text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

alter table plant_findings enable row level security;

create policy "plant_findings: grow member read"
  on plant_findings for select
  using (
    exists (
      select 1 from grows g
      left join grow_members gm on gm.grow_id = g.id
      where g.id = plant_findings.grow_id
        and (g.owner_id = auth.uid() or gm.user_id = auth.uid())
    )
  );

-- Findings are written by the server (service role) only
-- No user-facing insert policy; use service role key from Next.js routes

-- ─── grow_events ──────────────────────────────────────────────────────────────
create table grow_events (
  id          uuid primary key default uuid_generate_v4(),
  grow_id     uuid not null references grows(id) on delete cascade,
  plant_id    uuid references plants(id) on delete set null,
  user_id     uuid not null references auth.users(id),
  event_type  event_type not null,
  notes       text,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table grow_events enable row level security;

create policy "grow_events: grow member read"
  on grow_events for select
  using (
    exists (
      select 1 from grows g
      left join grow_members gm on gm.grow_id = g.id
      where g.id = grow_events.grow_id
        and (g.owner_id = auth.uid() or gm.user_id = auth.uid())
    )
  );

create policy "grow_events: member write"
  on grow_events for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from grows g
      left join grow_members gm on gm.grow_id = g.id
      where g.id = grow_events.grow_id
        and (g.owner_id = auth.uid() or gm.user_id = auth.uid())
    )
  );

-- ─── chat_threads ─────────────────────────────────────────────────────────────
create table chat_threads (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  grow_id    uuid references grows(id) on delete set null,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table chat_threads enable row level security;

create policy "chat_threads: owner only"
  on chat_threads for all
  using (auth.uid() = user_id);

-- ─── chat_messages ────────────────────────────────────────────────────────────
create table chat_messages (
  id        uuid primary key default uuid_generate_v4(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  role      message_role not null,
  content   text not null,
  metadata  jsonb,
  created_at timestamptz not null default now()
);

alter table chat_messages enable row level security;

create policy "chat_messages: thread owner read"
  on chat_messages for select
  using (
    exists (
      select 1 from chat_threads ct
      where ct.id = chat_messages.thread_id and ct.user_id = auth.uid()
    )
  );

-- Messages inserted by service role only; no user-facing insert policy

-- ─── Indexes ──────────────────────────────────────────────────────────────────
create index idx_plants_grow_id on plants(grow_id);
create index idx_plant_images_plant_id on plant_images(plant_id);
create index idx_plant_images_taken_at on plant_images(taken_at desc);
create index idx_plant_findings_plant_id on plant_findings(plant_id);
create index idx_plant_findings_severity on plant_findings(severity);
create index idx_grow_events_grow_id on grow_events(grow_id);
create index idx_grow_events_occurred_at on grow_events(occurred_at desc);
create index idx_chat_messages_thread_id on chat_messages(thread_id);
create index idx_chat_messages_created_at on chat_messages(created_at asc);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();

create trigger trg_grows_updated_at
  before update on grows
  for each row execute function update_updated_at();

create trigger trg_plants_updated_at
  before update on plants
  for each row execute function update_updated_at();

create trigger trg_chat_threads_updated_at
  before update on chat_threads
  for each row execute function update_updated_at();

-- ─── Auto-create profile on signup ────────────────────────────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
