import "server-only";
import type { NextRequest } from "next/server";
import {
  getOrCreateRequestId,
  logServerEvent,
  REQUEST_ID_HEADER,
} from "./request-id";
import { noStore } from "./response-headers";
import { traceContextFromRequest } from "./trace-context";

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

/**
 * Map an HTTP status to the structured log level we want to surface
 * it at. The bands let dashboards / alerts filter sanely:
 *
 *   - `5xx` → `error` so the on-call pipeline pages on real outages.
 *   - `4xx` → `warn` because client errors are worth flagging
 *     (spike of 401s → leaked-token suspicion, spike of 422s → bad
 *     client deploy) but should not page.
 *   - everything else → `info`.
 *
 * `else → info` includes 2xx and 3xx; 1xx isn't a real terminal
 * response shape our routes produce so it's not special-cased.
 */
function levelForStatus(status: number): "error" | "warn" | "info" {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

export function withRouteLogging<Args extends unknown[]>(
  routeName: string,
  handler: LoggedHandler<Args>,
): LoggedHandler<Args> {
  return async (req, ...rest) => {
    // `performance.now()` is monotonic and sub-ms; immune to NTP
    // adjustments mid-request that could make `Date.now()` go
    // backwards and yield a negative durationMs.
    const started = performance.now();
    const method = req.method;
    // Build the trace context once at the route boundary. The same
    // (traceId, spanId, parentSpanId) is then emitted in both the
    // completion log and the failure log, so a single request always
    // grep-matches the same trace identifier across every line we
    // produce. parentSpanId is null when this route is the trace
    // originator (no upstream traceparent header).
    const trace = traceContextFromRequest(req);
    try {
      const response = await handler(req, ...rest);
      // Apply the default Cache-Control for authed API responses. The
      // wrapped routes are all session-scoped today (analyze, upload
      // sign, upload refresh), so `private, no-store` is the correct
      // baseline — it prevents intermediate proxies and shared caches
      // from holding onto per-user data. `noStore` is a no-op when
      // the handler already set its own Cache-Control (e.g. the
      // streaming chat route opts into `no-store, no-transform`), so
      // routes that need a different policy keep control of it.
      noStore(response);
      // Prefer the requestId the handler actually attached to the
      // response. When the inbound request has no `x-request-id`
      // header, both the wrapper and the handler would otherwise
      // mint INDEPENDENT UUIDs via `getOrCreateRequestId`, and the
      // log line would carry a different id than the client sees.
      // Reading the header back closes that correlation gap.
      const requestId =
        response.headers.get(REQUEST_ID_HEADER) || getOrCreateRequestId(req);
      logServerEvent(levelForStatus(response.status), "request completed", {
        route: routeName,
        method,
        status: response.status,
        requestId,
        traceId: trace.traceId,
        spanId: trace.spanId,
        ...(trace.parentSpanId ? { parentSpanId: trace.parentSpanId } : {}),
        durationMs: Math.round(performance.now() - started),
      });
      return response;
    } catch (err) {
      // On uncaught throw we can't read the response headers (none
      // exist yet), so we fall back to deriving the requestId from
      // the inbound header alone. This means a request that arrived
      // WITHOUT `x-request-id` and threw before producing a response
      // will get a fresh UUID here that doesn't match any subsequent
      // handler-side log. Memoising `getOrCreateRequestId` per
      // request (e.g. via a WeakMap keyed on the NextRequest) is a
      // worthwhile follow-up — out of scope here.
      const requestId = getOrCreateRequestId(req);
      logServerEvent("error", "request failed", {
        route: routeName,
        method,
        status: 500,
        requestId,
        traceId: trace.traceId,
        spanId: trace.spanId,
        ...(trace.parentSpanId ? { parentSpanId: trace.parentSpanId } : {}),
        durationMs: Math.round(performance.now() - started),
        error: err instanceof Error ? err.message : "unknown_error",
      });
      throw err;
    }
  };
}
