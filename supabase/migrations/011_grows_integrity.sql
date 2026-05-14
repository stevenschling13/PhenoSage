-- Migration: 011_grows_integrity
--
-- Closes two correctness gaps in the grows table that the
-- create-grow audit (PR #145) surfaced:
--
--   1. The server action returns "A grow with that name already exists"
--      when Postgres reports 23505, but no UNIQUE constraint exists on
--      (owner_id, name) today — so duplicates create silently and the
--      friendly error is dead code. This migration adds a partial
--      UNIQUE index on (owner_id, lower(name)) WHERE is_archived = false.
--      Case-insensitive (so "North Tent" vs "north tent" collide) and
--      partial (so archiving a grow frees its name for reuse — the
--      common case after a harvest cycle ends).
--
--   2. The application architecture treats `grow_members` as the source
--      of truth for membership, but no write path inserts the owner's
--      row on grow creation. Today this works because every RLS policy
--      ORs `auth.uid() = owner_id` with the grow_members lookup, but
--      it breaks the contract for any future write path that needs to
--      enumerate members (collaborator UIs, batch invite flows, audit
--      reports) and silently breaks the moment an RLS policy drops the
--      owner_id shortcut. We close it with a trigger so all write
--      paths (form action, chat tool's create_grow, any future
--      service-role import) get the owner_members row automatically.
--
-- Safety posture:
--   * The UNIQUE INDEX is partial — already-archived grows don't
--     consume name space. New duplicate inserts now fail with 23505,
--     which the application code already handles.
--   * The trigger function runs SECURITY DEFINER so the owner row
--     lands even when the inserting role doesn't have INSERT on
--     grow_members directly (e.g. service-role imports). RLS bypass
--     is acceptable here: the trigger only inserts a tightly-scoped
--     (NEW.id, NEW.owner_id, 'owner') row, never user-supplied data.
--   * The trigger uses ON CONFLICT DO NOTHING so re-running the
--     migration on an instance where some grows already have
--     manually-inserted owner rows (none today) is a no-op.
--   * Backfill: insert (id, owner_id, 'owner') for every existing
--     grow that doesn't already have it. Idempotent via NOT EXISTS.
--
-- Rollback (do NOT run unless explicitly approved):
--   drop trigger if exists trg_grows_insert_owner_member on grows;
--   drop function if exists grow_insert_owner_member();
--   drop index if exists grows_owner_name_unique;
--   -- Backfilled grow_members rows are kept on rollback so collaborator
--   -- assignments stay intact — the trigger is what we're removing,
--   -- not the data integrity invariant it backfills.

-- ─── 1. Partial UNIQUE index on (owner_id, lower(name)) ───────────────
-- Partial so archived grows free their name; case-insensitive so the UI
-- doesn't have to normalise. Build CONCURRENTLY is intentionally NOT
-- used because supabase migrations run inside a transaction; the
-- expected row count is small (per-user, dozens at most).

create unique index grows_owner_name_unique
  on grows (owner_id, lower(name))
  where is_archived = false;

-- ─── 2. Owner → grow_members trigger ──────────────────────────────────

create or replace function grow_insert_owner_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into grow_members (grow_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (grow_id, user_id) do nothing;
  return new;
end;
$$;

create trigger trg_grows_insert_owner_member
  after insert on grows
  for each row
  execute function grow_insert_owner_member();

-- ─── 3. Backfill existing grows ───────────────────────────────────────
-- Every existing grow needs its owner row so the new contract holds
-- universally. Idempotent — re-running this migration is safe.

insert into grow_members (grow_id, user_id, role)
select g.id, g.owner_id, 'owner'
from grows g
where not exists (
  select 1 from grow_members gm
  where gm.grow_id = g.id and gm.user_id = g.owner_id
);
