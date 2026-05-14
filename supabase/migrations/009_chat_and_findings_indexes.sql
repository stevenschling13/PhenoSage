-- Performance indexes for hot read paths.
--
-- chat_threads(user_id, updated_at desc): listThreadsForUser orders by
--   updated_at desc filtered by user_id. The only existing index is on
--   grow_id, which doesn't help.
--
-- plant_findings(grow_id, created_at desc): chat-context loads the most
--   recent findings per grow. Existing indexes are (plant_id), (severity),
--   (plant_id, severity), (image_id), and the embedding index — none cover
--   this access path.

create index if not exists idx_chat_threads_user_id_updated_at
  on public.chat_threads (user_id, updated_at desc);

create index if not exists idx_plant_findings_grow_id_created_at
  on public.plant_findings (grow_id, created_at desc);
