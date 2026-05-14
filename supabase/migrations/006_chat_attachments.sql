-- 006_chat_attachments.sql
-- Adds the join table for chat-message attachments (images uploaded inline in
-- the assistant chat) and enables Postgres-changes realtime on the analysis
-- tables so other pages can refresh live when a new analysis lands.
--
-- Design notes:
--   * One row per (chat_message, image). Chat MVP enforces at most one image
--     attachment per user message at the application layer; the schema does
--     not enforce that so future "compare these two photos" turns can attach
--     multiple without a migration.
--   * `analysis_id` is nullable + ON DELETE SET NULL because the analysis row
--     may be created asynchronously (timeout fallback path) or may be cleaned
--     up later without us wanting to lose the attachment record itself.
--   * RLS read = owner of the parent chat_thread (mirrors chat_messages
--     exactly, intentionally — the rubber-duck called this out as a
--     potential leak vector if we got it wrong).
--   * No user-facing INSERT policy: writes go through service-role from the
--     chat route, same posture as chat_messages.

create table chat_message_attachments (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references chat_messages(id) on delete cascade,
  kind        text not null check (kind in ('image')),
  plant_id    uuid not null references plants(id) on delete cascade,
  image_id    uuid not null references plant_images(id) on delete cascade,
  analysis_id uuid references plant_analyses(id) on delete set null,
  storage_path text not null,
  created_at  timestamptz not null default now()
);

alter table chat_message_attachments enable row level security;

create policy "chat_message_attachments: thread owner read"
  on chat_message_attachments for select
  using (
    exists (
      select 1
      from chat_messages cm
      join chat_threads ct on ct.id = cm.thread_id
      where cm.id = chat_message_attachments.message_id
        and ct.user_id = auth.uid()
    )
  );

create index idx_chat_message_attachments_message_id
  on chat_message_attachments(message_id);
create index idx_chat_message_attachments_plant_id
  on chat_message_attachments(plant_id);
create index idx_chat_message_attachments_image_id
  on chat_message_attachments(image_id);

-- ─── Realtime publication ────────────────────────────────────────────────────
-- Supabase Realtime watches the supabase_realtime publication. Tables added to
-- it AFTER the publication exists are NOT auto-included unless we explicitly
-- add them. The chat-driven analysis flow needs other open pages (plant
-- detail, dashboard, grow) to refresh when a new analysis row or finding
-- lands, so we add those tables here.
--
-- Wrapped in a DO block because re-running the migration on an environment
-- where the table is already published would otherwise throw.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plant_analyses'
  ) then
    execute 'alter publication supabase_realtime add table public.plant_analyses';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plant_findings'
  ) then
    execute 'alter publication supabase_realtime add table public.plant_findings';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plant_images'
  ) then
    execute 'alter publication supabase_realtime add table public.plant_images';
  end if;
end$$;
