# Contract-Safe Change Playbook

Use this checklist whenever you touch a **boundary**: a shared type, a
migration, an analysis-service request/response, or a Route Handler that the
client depends on.

## What is a "contract"?

A contract is anything observed across a process boundary:

| Boundary                          | Contract surface                                |
| --------------------------------- | ----------------------------------------------- |
| Browser ⇄ `apps/web` Route Handler | Request/response JSON shape; status codes       |
| `apps/web` ⇄ `apps/analysis`       | `apps/analysis/app/models/**` ↔ `packages/shared` |
| `apps/web` ⇄ Supabase Postgres     | Migration column names/types ↔ `packages/shared` |
| `apps/web` ⇄ Supabase Storage      | Bucket name + path convention                   |

## The Rule

**A contract change requires a coordinated edit on every side, in the same PR.**

## Step-by-step

1. **Identify the contract.** Which boundary is changing? Tick the matching
   row in the PR template.
2. **Decide: additive or breaking?**
   - **Additive** (new optional field, new endpoint): low risk. Add to all
     sides; defaults must be safe.
   - **Breaking** (rename, removal, type change): high risk. Prefer a
     parallel addition + deprecation step over an in-place rename.
3. **Update sides in this order**, all in one PR:
   1. `packages/shared/src/types.ts` (the source of truth)
   2. `supabase/migrations/NNN_*.sql` (new file, never edit existing)
   3. `apps/analysis/app/models/**` (Pydantic mirror)
   4. `apps/web/src/lib/server/**` (proxy + DB callers)
   5. `apps/web/src/app/api/**` (Route Handlers)
   6. Any client component that consumes the response
4. **Run the validators**:

   ```bash
   pnpm run validate
   pnpm run type-check
   pnpm run build
   cd apps/analysis && ruff check . && mypy app/ && pytest
   ```

5. **Document rollback** in the PR template's Rollback section. Migrations
   especially: how do we recover if production runs the new code with the
   old DB or vice versa?

## Anti-patterns to reject in review

- Changing a Pydantic model without changing the matching TS type.
- Renaming a SQL column in a new migration but not updating callers.
- Adding a field to `AnalysisResponse` that the analysis service never sets.
- Editing a previously-committed migration.
- "I'll update the other side in a follow-up PR" — no, do it in this PR.
