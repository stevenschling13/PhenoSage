-- Migration: account_deletion_fk_cascade
--
-- Prerequisite for in-app account deletion. `auth.admin.deleteUser()`
-- cascades through profiles → grows → plants → … (001), but three
-- content tables reference auth.users with NO ACTION:
--
--   * plant_images.user_id       (001:163)
--   * plant_observations.user_id (001:193)
--   * grow_events.user_id        (001:254)
--
-- and migration 003 added nullable audit columns (created_by /
-- updated_by on grows, plants, plant_observations, grow_events) that
-- also default to NO ACTION. Rows a user created inside ANOTHER
-- user's grow (grow_members) are not reached by the ownership cascade,
-- so deleting that user would abort with an FK violation.
--
-- Policy:
--   * Content authored by the departing user (images, observations,
--     events) is DELETED — privacy-correct: their contributions leave
--     with them.
--   * Audit columns are SET NULL — the row belongs to the grow, only
--     the attribution is cleared.
--
-- The existing constraints are discovered from pg_constraint and
-- dropped by their actual names rather than assumed default names, so
-- this cannot silently leave a stale NO ACTION constraint behind (a
-- guessed-name `drop constraint if exists` would no-op on mismatch and
-- the new cascade FK would then coexist with the old blocking one).
--
-- Rollback: re-create each constraint without the ON DELETE clause
-- (the pre-migration state). No data change is performed here.

do $$
declare
  spec record;
  con  record;
begin
  for spec in
    select *
    from (values
      ('plant_images',       'user_id',    'cascade'),
      ('plant_observations', 'user_id',    'cascade'),
      ('grow_events',        'user_id',    'cascade'),
      ('grows',              'created_by', 'set null'),
      ('grows',              'updated_by', 'set null'),
      ('plants',             'created_by', 'set null'),
      ('plants',             'updated_by', 'set null'),
      ('plant_observations', 'updated_by', 'set null'),
      ('grow_events',        'updated_by', 'set null')
    ) as t(table_name, column_name, on_delete)
  loop
    -- Drop every existing FK on this exact column that targets
    -- auth.users, whatever it happens to be named.
    for con in
      select c.conname
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any (c.conkey)
      where c.contype = 'f'
        and c.conrelid = format('public.%I', spec.table_name)::regclass
        and c.confrelid = 'auth.users'::regclass
        and a.attname = spec.column_name
    loop
      execute format(
        'alter table public.%I drop constraint %I',
        spec.table_name, con.conname
      );
    end loop;

    execute format(
      'alter table public.%I add constraint %I '
      || 'foreign key (%I) references auth.users(id) on delete %s',
      spec.table_name,
      spec.table_name || '_' || spec.column_name || '_fkey',
      spec.column_name,
      spec.on_delete
    );
  end loop;
end
$$;
