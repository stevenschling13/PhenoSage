/**
 * Alias for `/api/health` using the conventional `/healthz` path that
 * deployment smoke checks (`scripts/smoke-preview.mjs`), uptime probers,
 * and load-balancer health checks default to.
 *
 * The body is intentionally minimal and contains zero secrets / env-var
 * inventory — public probers can hit this without auth.
 */
export { GET } from "../health/route";

// `runtime` must be declared directly in each route file — Next.js
// route-segment config cannot be re-exported from another module.
export const runtime = "edge";
