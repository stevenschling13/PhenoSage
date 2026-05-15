-- Migration: 013_pgvector_extensions_schema
--
-- Moves `pgvector` from the `public` schema to a dedicated
-- `extensions` schema, closing the Supabase advisor warning
-- `extension_in_public`. Best-practice keeps extension objects out
-- of `public` so they don't collide with user types/functions and
-- don't appear in PostgREST's generated API surface.
--
-- # Why this is safe today
--
--   1. The `plant_findings.embedding` column tracks the `vector`
--      type by OID, which doesn't change when the extension's
--      schema changes. The column type stays valid after the move.
--
--   2. The IVFFlat index `idx_plant_findings_embedding` references
--      the `vector_cosine_ops` operator class, also tracked by OID.
--      The index remains valid.
--
--   3. There are zero rows in `plant_findings` with non-NULL
--      embeddings today (verified via MCP at apply time), so a
--      worst-case index rebuild costs nothing.
--
--   4. The `postgres` role already has `extensions` in its
--      search_path. The `anon`, `authenticated`, and `service_role`
--      roles do not — this migration adds it so unqualified `vector`
--      type casts (e.g. `'[1,2,3]'::vector`) still resolve.
--
-- # Out of scope
--
-- The `authenticator` connection-pool role keeps its default
-- search_path. Supabase manages that role; overriding it can break
-- PostgREST schema reloads.
--
-- # Safety posture
--
--   * The `create schema if not exists` and `alter extension ...
--     set schema` are idempotent (re-running is a no-op once
--     applied).
--   * `grant usage on schema extensions to ...` is idempotent.
--   * `alter role ... set search_path` overwrites the existing
--     setting; if any prior migration set a different search_path
--     on these roles, this migration would clobber it. None do
--     today.
--
-- # Rollback (do NOT run unless explicitly approved)
--
--   alter extension vector set schema public;
--   alter role anon          reset search_path;
--   alter role authenticated reset search_path;
--   alter role service_role  reset search_path;
--   revoke usage on schema extensions from anon, authenticated, service_role;
--   -- (don't drop `extensions` — other extensions may live there too)

create schema if not exists extensions;

-- Make the extension's types/functions discoverable to PostgREST
-- callers without them having to fully qualify.
grant usage on schema extensions to anon, authenticated, service_role;

-- The actual move. Catalog references in dependent objects
-- (plant_findings.embedding column, idx_plant_findings_embedding
-- index) follow the OID automatically.
alter extension vector set schema extensions;

-- Roles need `extensions` in their search_path so SQL written as if
-- vector were in `public` still resolves. We use the canonical
-- Supabase ordering: per-user first, then public, then extensions.
alter role anon          set search_path = "$user", public, extensions;
alter role authenticated set search_path = "$user", public, extensions;
alter role service_role  set search_path = "$user", public, extensions;
