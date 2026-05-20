-- Migration: plant_analyses_grow_analyzed_at_idx
--
-- The grow detail page (`apps/web/src/app/(app)/grows/[id]/page.tsx`)
-- introduced `getGrowHealthTrend(growId)` which filters
-- `plant_analyses` by `grow_id` and `analyzed_at`. The existing
-- indexes from migration 004 cover `(plant_id, analyzed_at)` and
-- `(image_id)` but not `grow_id`, so the new query path can fall
-- back to a sequential scan + in-memory sort on grows with many
-- analyses.
--
-- This index makes the trend query a direct index range scan and
-- keeps the grow detail page snappy regardless of the underlying
-- analysis volume. DESC on `analyzed_at` matches the query's
-- ordering (newest-first, post-fix on PR #226 follow-up) so the
-- planner can stream the limited result set without a sort node.

create index if not exists idx_plant_analyses_grow_id_analyzed_at
  on plant_analyses (grow_id, analyzed_at desc);
