-- Migration: grow_tasks_realtime
--
-- Adds `grow_tasks` to the `supabase_realtime` publication so the
-- cross-grow triage queue (`/triage`, shipped in PR #225) and any
-- future task-aware surface can subscribe to live INSERT / UPDATE
-- events. Today the page renders server-side at request time, so a
-- grower had to manually reload to see a newly spawned task or a
-- status change from a collaborator.
--
-- Wrapped in a DO block because re-running the migration on an
-- environment where the table is already published would otherwise
-- throw. Mirrors the pattern from 006_chat_attachments.sql.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'grow_tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.grow_tasks';
  end if;
end$$;
