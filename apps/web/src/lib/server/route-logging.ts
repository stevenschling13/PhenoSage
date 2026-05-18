import "server-only";
import type { NextRequest } from "next/server";
import { getOrCreateRequestId, logServerEvent } from "./request-id";

/**
 * Higher-order wrapper that emits a structured `request completed` log
 * line for every invocation of a route handler.
 *
 * Why a wrapper instead of an actual Next.js middleware:
 *   - This repo deliberately forbids adding `middleware.ts` to
 *     `apps/web` (see CLAUDE.md non-negotiables) because the auth /
 *     security boundary lives in the route handlers themselves and we
 *     don't want a second cross-cutting layer with its own runtime
 *     constraints. A composable wrapper keeps the same observability
 *     win without that boundary cost.
 *
 * Emitted fields:
 *   - `route`     — stable identifier supplied at wrap time. Keep it
 *                   low-cardinality (no per-id values) so log
 *                   aggregations can group on it cleanly.
 *   - `method`    — HTTP verb.
 *   - `status`    — HTTP status code returned by the handler. 500
 *                   when the handler threw (the throw still
 *                   propagates after the log).
 *   - `requestId` — resolved from the inbound `x-request-id` header
 *                   when present, otherwise newly minted. Matches
 *                   whatever the handler itself sees via
 *                   `getOrCreateRequestId`.
 *   - `durationMs` — wall-clock time in milliseconds, rounded.
 *
 * What this wrapper deliberately does NOT log:
 *   - User id / session info. Each route already resolves its own
 *     auth context and emits route-specific logs; duplicating it here
 *     would mean a double-fetch on every request just to get a field.
 *   - Request / response bodies. Bodies can contain PII and signed
 *     URLs; the timing log is a request-envelope concern, not a
 *     content concern.
 *
 * Streaming caveat: for routes that return a `ReadableStream`
 * (chat), the `status` field reflects the *response object* returned
 * by the handler — typically 200 even if a downstream model error
 * later aborts the stream. Use route-internal logs to track stream
 * completion / failure separately.
 */

export type LoggedHandler<Args extends unknown[]> = (
  _req: NextRequest,
  ..._rest: Args
) => Promise<Response>;

export function withRouteLogging<Args extends unknown[]>(
  routeName: string,
  handler: LoggedHandler<Args>,
): LoggedHandler<Args> {
  return async (req, ...rest) => {
    const requestId = getOrCreateRequestId(req);
    const started = Date.now();
    const method = req.method;
    try {
      const response = await handler(req, ...rest);
      logServerEvent("info", "request completed", {
        route: routeName,
        method,
        status: response.status,
        requestId,
        durationMs: Date.now() - started,
      });
      return response;
    } catch (err) {
      // Log the failure envelope first, then re-throw so the
      // framework's error handling (default 500, Sentry capture if
      // wired) still runs unchanged. We deliberately don't catch
      // here — the wrapper's only job is to record the envelope.
      logServerEvent("error", "request failed", {
        route: routeName,
        method,
        status: 500,
        requestId,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : "unknown_error",
      });
      throw err;
    }
  };
}
