-- Migration: 012_function_hardening
--
-- Closes the security advisor warnings introduced by migrations 003,
-- 005, 008, and the inherited `update_updated_at` from 001:
--
--   1. **Function search_path hardening** — five plpgsql functions in
--      `public` were created without `SET search_path = …`, which the
--      Supabase linter flags as `function_search_path_mutable`. A
--      function with a mutable search_path can resolve unqualified
--      object names against whatever the calling role has in
--      `search_path` at runtime — a known privilege-escalation vector
--      for SECURITY DEFINER functions, and best-practice to lock down
--      for SECURITY INVOKER functions too (forward-compat if the
--      function is later promoted, and to suppress the lint).
--
--   2. **REVOKE EXECUTE on trigger-only SECURITY DEFINER functions** —
--      `grow_insert_owner_member` (migration 011) and
--      `plant_findings_auto_task` (migration 008) are only ever invoked
--      from row-level triggers, but were created without explicit
--      REVOKEs, so Supabase exposed them at `/rest/v1/rpc/…` callable by
--      `anon` and `authenticated`. We revoke EXECUTE from all three
--      principals (`public`, `anon`, `authenticated`) so the only path
--      that reaches them is the trigger that owns them.
--
--      `enqueue_analysis_job` (migration 005) already revoked
--      `authenticated` + `public`, but the linter still flagged `anon`
--      executable. We add an explicit `revoke from anon` for parity.
--
-- Out of scope (deferred to a separate PR after careful staging):
--   * Moving `pgvector` from `public` to an `extensions` schema. The
--     `idx_plant_findings_embedding` index already exists and uses the
--     `vector_cosine_ops` operator class — moving the extension is
--     safe in theory but worth its own change-window so any ORM /
--     migration tooling that hard-codes `public.vector` can be caught.
--   * `handle_new_user` and `rls_auto_enable` are Supabase-managed and
--     left untouched.
--   * `auth_leaked_password_protection` is an Auth-dashboard toggle
--     (Settings → Auth → Password Strength → HaveIBeenPwned), not a
--     SQL change.
--
-- Safety posture:
--   * Every `ALTER FUNCTION … SET search_path = public` is idempotent
--     and changes only the function's metadata — no schema changes,
--     no data motion.
--   * REVOKEs against absent grants are no-ops in Postgres, so the
--     migration is safe to re-run.
--
-- Rollback (do NOT run unless explicitly approved):
--   alter function public.grow_tasks_touch_updated_at()           reset search_path;
--   alter function public.plant_findings_user_update_guard()      reset search_path;
--   alter function public.set_analysis_jobs_updated_at()          reset search_path;
--   alter function public.set_audit_columns()                     reset search_path;
--   alter function public.update_updated_at()                     reset search_path;
--   grant execute on function public.grow_insert_owner_member()   to anon, authenticated, public;
--   grant execute on function public.plant_findings_auto_task()   to anon, authenticated, public;
--   grant execute on function public.enqueue_analysis_job(uuid, uuid, uuid, uuid, text, integer) to anon;

-- ─── 1. search_path hardening ────────────────────────────────────────

alter function public.grow_tasks_touch_updated_at()
  set search_path = public;

alter function public.plant_findings_user_update_guard()
  set search_path = public;

alter function public.set_analysis_jobs_updated_at()
  set search_path = public;

alter function public.set_audit_columns()
  set search_path = public;

alter function public.update_updated_at()
  set search_path = public;

-- ─── 2. REVOKE EXECUTE on trigger-only SECURITY DEFINER functions ────

-- Trigger on grows.AFTER INSERT (migration 011). No RPC use case.
revoke execute on function public.grow_insert_owner_member()
  from public, anon, authenticated;

-- Trigger on plant_findings.AFTER INSERT (migration 008). No RPC use case.
revoke execute on function public.plant_findings_auto_task()
  from public, anon, authenticated;

-- Server-only (migration 005 grants execute only to service_role). The
-- explicit `from anon` is belt-and-suspenders so the linter's
-- `anon_security_definer_function_executable` warning clears even on
-- environments where the original REVOKE didn't catch `anon`.
revoke execute on function public.enqueue_analysis_job(
  p_plant_id uuid,
  p_image_id uuid,
  p_grow_id uuid,
  p_requested_by uuid,
  p_idempotency_key text,
  p_max_attempts integer
) from public, anon, authenticated;
