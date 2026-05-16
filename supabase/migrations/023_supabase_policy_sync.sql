-- Migration: 023_supabase_policy_sync
-- Purpose:   Keep Supabase policies aligned with the current app behavior after
--            the RLS recursion fix and plantId-based storage object paths.
-- Writers:   No table data is written by this migration. It only replaces RLS
--            and Storage policies.
-- Rollback:  Recreate "grows: member read" from migration 022 and restore the
--            legacy "plant-images: owner delete" policy from migration 002.

begin;

-- Migration 022 intentionally replaced the recursive grow read policy with
-- SECURITY DEFINER helpers, but it accidentally dropped migration 003's
-- soft-delete filter. Restore that filter while keeping the non-recursive
-- helper call. Owners can still read archived grows through the existing
-- "grows: owner write" FOR ALL policy.
drop policy if exists "grows: member read" on public.grows;
create policy "grows: member read"
  on public.grows
  for select
  using (
    is_archived = false
    and (
      auth.uid() = owner_id
      or private.is_grow_member(id)
    )
  );

-- Current upload paths are shaped as {plantId}/{timestamp}-{imageId}-{filename}.
-- The original delete policy expected the first path segment to be auth.uid(),
-- so direct authenticated deletes never matched the app's object paths. Align
-- the policy with the same plant ownership check used by the hardened upload
-- policy in migration 003.
drop policy if exists "plant-images: owner delete" on storage.objects;
create policy "plant-images: owner delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'plant-images'
    and exists (
      select 1
      from public.plants p
      join public.grows g on g.id = p.grow_id
      where g.owner_id = auth.uid()
        and p.id::text = (storage.foldername(storage.objects.name))[1]
    )
  );

commit;
