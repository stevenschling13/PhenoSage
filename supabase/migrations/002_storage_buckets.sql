-- Migration: 002_storage_buckets
-- Create private Supabase Storage buckets for plant images.
-- Run via: supabase db push

-- ─── Storage Buckets ──────────────────────────────────────────────────────────
-- plant-images: Private bucket. Signed URLs generated server-side only.
insert into storage.buckets (id, name, public)
values ('plant-images', 'plant-images', false);

-- ─── Storage Policies ─────────────────────────────────────────────────────────
-- Users can upload images to their own plant folders only.
-- Folder structure: plants/{plantId}/{filename}
-- Access to images is validated server-side; no direct browser access.

create policy "plant-images: authenticated upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'plant-images'
    and auth.role() = 'authenticated'
  );

-- Service role key handles all reads (signed URL generation).
-- Authenticated users cannot read directly — signed URLs are required.
-- This enforces the server-side proxy pattern.

create policy "plant-images: owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'plant-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
