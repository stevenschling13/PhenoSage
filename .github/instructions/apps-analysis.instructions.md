---
applyTo: "apps/analysis/**"
---

# apps/analysis — FastAPI Service Rules

- Python 3.12, FastAPI, Pydantic v2.
- Strict typing: `mypy app/` must pass. No `Any` without justification.
- The service is **private**. The only legitimate caller is the Next.js
  proxy (`apps/web/src/lib/server/analysis-proxy.ts`).

## Contract symmetry

- Request/response models in `app/models/**` must mirror the TypeScript
  shapes in `packages/shared/src/types.ts`. Any rename or field change
  requires a coordinated edit on **both** sides in the same PR.

## Auth

- Every non-`/health` route requires a valid bearer token matching
  `ANALYSIS_SERVICE_API_KEY` (issued only to the Vercel deployment).
- Never trust `Origin`/`Referer` for auth — those are spoofable.

## CORS

- Allow only the configured `ALLOWED_ORIGINS` (the Vercel app domain).
- Do not enable wildcard origins.

## Forbidden in this tree

- Calling Supabase directly with the service role key. The web app owns DB
  writes; the analysis service is a stateless compute backend.
- Adding endpoints intended for browser consumption.
- Long-running synchronous endpoints — return job IDs and poll if needed.
