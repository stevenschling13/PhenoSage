import "server-only";

/**
 * W3C Trace Context propagation helpers.
 *
 * Spec: https://www.w3.org/TR/trace-context/
 *
 * The `traceparent` header carries four positional fields separated
 * by `-`:
 *
 *   version-traceId-parentSpanId-traceFlags
 *
 * For example:
 *
 *   00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 *
 *   - **version** is `00` (the only one currently defined).
 *   - **traceId** is 32 lowercase hex chars (128 bits). Stays the
 *     SAME across every hop of a single trace.
 *   - **parentSpanId** is 16 lowercase hex chars (64 bits). The id
 *     of the span the caller just created — i.e. the parent of the
 *     span the receiver is about to create.
 *   - **traceFlags** is 2 hex chars; `00` = unsampled, `01` =
 *     sampled. We propagate whatever the upstream sent without
 *     making a sampling decision ourselves — that's a Sentry / OTel
 *     concern.
 *
 * What this module deliberately does NOT do:
 *
 *   - No `tracestate` parsing. We propagate `tracestate` opaquely
 *     when implemented later; for now we only handle the basic
 *     `traceparent` field which is enough to correlate web →
 *     analysis logs end-to-end.
 *   - No actual OpenTelemetry SDK integration. That's a follow-up.
 *     The data we emit is structured-log-friendly so future OTel
 *     wiring can backfill spans from these fields.
 */

export const TRACEPARENT_HEADER = "traceparent";

/**
 * Anchored regex covering the only currently-defined `version=00`
 * shape. Reject malformed inbound traceparent values defensively
 * because a typo'd or attacker-crafted value could otherwise pollute
 * our trace ids and make grep-by-trace useless.
 */
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface ParsedTraceparent {
  traceId: string;
  parentSpanId: string;
  flags: string;
}

export function parseTraceparent(
  value: string | null | undefined,
): ParsedTraceparent | null {
  if (!value) return null;
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  if (!match) return null;
  // Non-null assertion is safe because the regex requires all four
  // groups; the spec also forbids the all-zero variants (traceId
  // `0`*32 or parentSpanId `0`*16). Defending against those keeps
  // bogus values out of our logs.
  const [, traceId, parentSpanId, flags] = match as unknown as [
    string,
    string,
    string,
    string,
  ];
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) return null;
  return { traceId, parentSpanId, flags };
}

/**
 * `crypto.getRandomValues` works in both Node and Edge runtimes. We
 * use it directly because `crypto.randomUUID()` produces a UUID with
 * dashes and version/variant bits set, which is the wrong shape for
 * a W3C trace id.
 */
function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

export function generateTraceId(): string {
  return randomHex(16);
}

export function generateSpanId(): string {
  return randomHex(8);
}

export interface TraceContext {
  /** Header value the current span should emit on outbound calls and in its own log lines. */
  traceparent: string;
  /** Stable across all hops of the same trace; the join key for grep / correlation. */
  traceId: string;
  /** The id of the current span — the one this hop is producing. */
  spanId: string;
  /** The id of the upstream span if there was one. Null if this hop is the trace originator. */
  parentSpanId: string | null;
  /** Two-hex-char flags, propagated as-is. */
  flags: string;
}

/**
 * Build the trace context the current route should log and forward.
 *
 *   - If a valid inbound `traceparent` is present, continue the
 *     trace: keep its `traceId`, mint a fresh `spanId`, treat the
 *     inbound `parentSpanId` as our parent, preserve flags.
 *   - If no header (or malformed), this hop is the originator:
 *     mint a fresh `traceId` and `spanId`, parent is null, flags
 *     default to `00` (unsampled — Sentry will upgrade later).
 *
 * The returned `traceparent` is the wire value the current span
 * should emit (header on outbound, field in logs). NOT the inbound
 * value, which is now historical.
 */
export function buildTraceContext(
  inboundTraceparent: string | null | undefined,
): TraceContext {
  const parsed = parseTraceparent(inboundTraceparent);
  const traceId = parsed?.traceId ?? generateTraceId();
  const spanId = generateSpanId();
  const parentSpanId = parsed?.parentSpanId ?? null;
  const flags = parsed?.flags ?? "00";
  return {
    traceparent: `00-${traceId}-${spanId}-${flags}`,
    traceId,
    spanId,
    parentSpanId,
    flags,
  };
}

/** Convenience: read the inbound header from a `Request` and build the context. */
export function traceContextFromRequest(request: Request): TraceContext {
  return buildTraceContext(request.headers.get(TRACEPARENT_HEADER));
}
