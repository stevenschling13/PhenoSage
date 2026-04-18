---
name: phenosage-api-sync
description: Keep packages/shared contracts in sync with the FastAPI analysis service pydantic models. Use whenever analyze_router.py, its request/response schemas, or packages/shared types.ts change.
---

# phenosage-api-sync

The Next.js web app calls the FastAPI analysis service through `apps/web/src/lib/server/analysis-proxy.ts`. Both sides must agree on the wire format. The source of truth on the Python side is `apps/analysis/app/models/analysis.py` (pydantic). On the TS side it's `packages/shared/src/types.ts`.

## When drift is suspected

1. Fetch the running OpenAPI schema:

   ```bash
   curl -fsS "$ANALYSIS_SERVICE_URL/openapi.json" > /tmp/phenosage-openapi.json
   ```

2. Diff the key schemas against `packages/shared/src/types.ts`:
   - `AnalysisRequest` ↔ arguments of `analyzeImage(...)` in `analysis-proxy.ts`
   - `AnalysisResponse` ↔ `AnalysisResponse` in `shared/types.ts`
   - `AnalysisFinding` ↔ `AnalysisFinding` in `shared/types.ts`

3. Any new optional field: add to the TS type as `?: T` and to pydantic with a default.

4. Any new required field: land the TS type + web callsite update first, then the Python side, then reverse order on rollback.

## Guard against drift

`packages/shared/src/__tests__/types.test.ts` asserts the shape of the known unions. When a union changes, update both sides and the test.

## Never

- Change a field's type without a migration plan — the browser cache + Supabase row cache will serve the old shape.
- Call the analysis service directly from a client component. Always go through `@/lib/server/analysis-proxy`.
