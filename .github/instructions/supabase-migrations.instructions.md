---
applyTo: "supabase/migrations/**"
---

# supabase/migrations — Migration Rules

- Migrations are **append-only**. Never edit a committed migration; add a
  new `NNN_description.sql` instead.
- Numbering is monotonic, zero-padded to 3 digits: `001`, `002`, `003`.
- Every new app-facing table in the `public` schema **must**:
  1. `enable row level security`
  2. Define at least one `policy`
  3. Document who writes (user vs service role) in a SQL comment

## Style

- Lowercase SQL keywords (`create table`, `alter table`).
- Use `uuid` PKs with `default uuid_generate_v4()` unless there's a strong reason not to.
- Use `timestamptz` for all time columns. Default to `now()`.
- Add indexes for foreign keys and any column used in `where`/`order by` on hot paths.

## Forbidden

- `drop column`, `drop table`, or destructive `alter` without a follow-up
  migration plan documented in the PR.
- Public Storage buckets for user-generated content.
- Committing seed data with real PII.
