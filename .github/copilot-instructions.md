# PhenoSage — Copilot / AI Agent Instructions

These rules govern **all** AI-assisted changes to this repository. They are
enforced by scripts in `scripts/` and by CI. If a rule can be enforced by a
script, it **is**. Treat these as load-bearing.

---

## 1. Architecture Boundaries (non-negotiable)

```
Browser ── HTTPS ──► Vercel (apps/web)  ──► Supabase  (auth/db/private storage)
                                       └──► Railway   (apps/analysis, FastAPI)
```

- **Vercel-hosted Next.js (`apps/web`) is the only public origin.**
- **The browser MUST NEVER call the analysis service or Supabase service-role APIs directly.**
- All browser-to-backend traffic flows through **same-origin Next.js Route Handlers** under `apps/web/src/app/api/**`.
- Server-only modules live in `apps/web/src/lib/server/**` and **must** import `"server-only"` at the top.
- Do **not** introduce a `middleware.ts` or `proxy.ts` to act as a backend proxy. Same-origin Route Handlers are the boundary. (Next 16 renamed `middleware` → `proxy`; both are blocked.)

## 2. Secrets & Environment

- Anything prefixed `NEXT_PUBLIC_*` is shipped to the browser. Treat it as public.
- `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANALYSIS_SERVICE_URL`, `ANALYSIS_SERVICE_API_KEY`, and any other backend credentials are **server-only**. They must:
  - Never appear in client components, client-imported modules, or `NEXT_PUBLIC_*` vars.
  - Only be read inside `apps/web/src/lib/server/**` or Route Handlers.
- Adding a new env var requires updating **both** the relevant `.env.example` **and** the env contract enforced by `scripts/check-env-contract.mjs`.

## 3. Contract-Safe Shared Types

- All cross-service contracts live in `packages/shared/src/types.ts`.
- The `apps/web` proxy and `apps/analysis` request/response models must agree with these types.
- Renaming or removing a field is a **breaking change**: update the migration, the FastAPI Pydantic models, the shared TS types, and the Route Handler in the **same PR**.

## 4. Database & RLS

- Every app-facing table in the `public` schema **must** have `enable row level security` and at least one policy.
- Service-role inserts (e.g., AI-generated `plant_findings`) are explicit: no user-facing insert policy required, but document the writer.
- New migrations go in `supabase/migrations/NNN_description.sql` and are append-only — never edit a committed migration.

## 5. Storage

- Plant images live in **private** Supabase Storage buckets only.
- Browser uploads use server-issued signed upload URLs (`/api/uploads/sign`).
- Browser reads use server-issued signed download URLs. No public buckets for user content, ever.

## 6. Forbidden Changes

The following are **rejected** in PR review and most are blocked by `scripts/check-route-boundaries.mjs`:

- Importing `@/lib/server/**` from a client component (`"use client"`).
- Reading `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANALYSIS_SERVICE_*` outside `apps/web/src/lib/server/**` or Route Handlers.
- Calling `process.env.ANALYSIS_SERVICE_URL` or `fetch("https://*.railway.app/...")` from any client-side code.
- Adding a public Supabase Storage bucket for user content.
- Adding SQLite, a second database, or an unrelated microservice.
- Creating a `middleware.ts` or `proxy.ts` to proxy to backend services.
- Adding broad social/community/ecommerce features (out of scope).
- Adding native mobile code (out of scope; the web app is mobile-compatible).
- Editing a previously-committed migration in `supabase/migrations/**`.

## 7. Change Discipline

- **Small, bounded PRs.** One concern per PR. If you touch more than ~6 files outside generated/docs, split it.
- Prefer **executable guardrails** (a script, a test) over a paragraph of prose.
- Do not create new long-form coordination/state markdown files. Update existing docs instead.
- Update `docs/roadmap.md` only when scope actually changes.

## 8. Validation Commands

Run before opening a PR. CI runs the same set.

```bash
pnpm install --frozen-lockfile
pnpm run validate            # runs all scripts/check-*.mjs
pnpm run type-check
pnpm run lint
pnpm run test                # or: pnpm turbo run type-check lint test
pnpm run build               # web build with stub envs is fine locally
pnpm run security:routes     # route-handler security audit
pnpm run pr:guardian         # PR size / scope caps (advisory locally)
```

Python (analysis service):

```bash
cd apps/analysis
pip install -r requirements.txt
ruff check .
mypy app/
pytest
```

## 9. Plant-Health Output Discipline

PhenoSage tells growers what's wrong with their plants. Wrong answers cause real
crop loss. Therefore:

- If any upstream dependency fails — image analysis, storage, OpenAI, context
  retrieval, the analysis service — the user-facing result must be an explicit
  **inconclusive / non-diagnostic** state, not a confident diagnosis.
- Never present a fallback, simulated, cached-stale, or partial result as a
  definitive diagnosis. Distinguishing `started`, `succeeded`, `failed`,
  `retried`, `timed out`, and `inconclusive` is required for any analysis
  workflow.
- Do not soften this rule with a "best-effort" wording in the UI; surface the
  inconclusive state and the reason.

## 10. When in Doubt

- Read `docs/playbooks/repo-aware-ai-coding-playbook.md` for the operating model.
- Read `docs/playbooks/contract-safe-change-playbook.md` before changing any shared type, migration, or proxy boundary.
- If a requested change appears to violate any rule above, **stop and surface it** in the PR description rather than working around it.
