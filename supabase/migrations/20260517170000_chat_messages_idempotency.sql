-- Migration: chat_messages_idempotency
-- Purpose:   Add an opt-in idempotency_key column to chat_messages plus a
--            partial unique index so that retrying the same client request
--            (e.g. network blip mid-stream, user double-click on send) does
--            not create duplicate user-message rows in a thread.
--
--            Mirrors the pattern established for analysis_jobs in migration
--            005: a partial unique index on (thread_id, idempotency_key)
--            WHERE idempotency_key IS NOT NULL means the constraint only
--            applies to writes that opt into dedup, leaving legacy
--            assistant-side inserts (which don't carry a key) unaffected.
--
-- Writers:   No data written. Schema-only.
-- Rollback:
--   begin;
--   drop index if exists idx_chat_messages_thread_idem;
--   alter table chat_messages drop column if exists idempotency_key;
--   commit;

begin;

alter table chat_messages
  add column if not exists idempotency_key text;

create unique index if not exists idx_chat_messages_thread_idem
  on chat_messages(thread_id, idempotency_key)
  where idempotency_key is not null;

commit;
