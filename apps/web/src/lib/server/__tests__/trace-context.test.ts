import { describe, expect, it } from "vitest";
import {
  buildTraceContext,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
  traceContextFromRequest,
  TRACEPARENT_HEADER,
} from "../trace-context";

const VALID_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const VALID_SPAN_ID = "b7ad6b7169203331";
const VALID_TRACEPARENT = `00-${VALID_TRACE_ID}-${VALID_SPAN_ID}-01`;

describe("parseTraceparent", () => {
  it("accepts a well-formed value", () => {
    expect(parseTraceparent(VALID_TRACEPARENT)).toEqual({
      traceId: VALID_TRACE_ID,
      parentSpanId: VALID_SPAN_ID,
      flags: "01",
    });
  });

  it.each([
    ["null", null],
    ["empty string", ""],
    ["wrong version", "01-" + VALID_TRACE_ID + "-" + VALID_SPAN_ID + "-01"],
    ["short trace id", "00-abc-" + VALID_SPAN_ID + "-01"],
    [
      "uppercase hex",
      "00-" + VALID_TRACE_ID.toUpperCase() + "-" + VALID_SPAN_ID + "-01",
    ],
    ["short span id", "00-" + VALID_TRACE_ID + "-abc-01"],
    ["short flags", "00-" + VALID_TRACE_ID + "-" + VALID_SPAN_ID + "-1"],
    // The spec forbids all-zero trace/span ids — they're a common
    // shape from misconfigured emitters and would otherwise pollute
    // our trace correlation.
    ["all-zero trace id", "00-" + "0".repeat(32) + "-" + VALID_SPAN_ID + "-01"],
    ["all-zero span id", "00-" + VALID_TRACE_ID + "-" + "0".repeat(16) + "-01"],
  ])("rejects %s", (_label, value) => {
    expect(parseTraceparent(value)).toBeNull();
  });

  it("trims surrounding whitespace before parsing", async () => {
    expect(parseTraceparent(`  ${VALID_TRACEPARENT}  `)).toEqual({
      traceId: VALID_TRACE_ID,
      parentSpanId: VALID_SPAN_ID,
      flags: "01",
    });
  });
});

describe("generateTraceId / generateSpanId", () => {
  it("emits lowercase hex of the expected width", () => {
    for (let i = 0; i < 20; i++) {
      const traceId = generateTraceId();
      const spanId = generateSpanId();
      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("produces different values across calls (sanity check on RNG)", () => {
    // Not a cryptographic-randomness assertion, just a smoke test
    // that we're calling getRandomValues each time rather than
    // returning a memoised constant.
    const a = generateTraceId();
    const b = generateTraceId();
    expect(a).not.toBe(b);
  });
});

describe("buildTraceContext", () => {
  it("continues an inbound trace: preserves traceId, mints a fresh spanId, parent = inbound span", () => {
    const ctx = buildTraceContext(VALID_TRACEPARENT);
    expect(ctx.traceId).toBe(VALID_TRACE_ID);
    expect(ctx.parentSpanId).toBe(VALID_SPAN_ID);
    expect(ctx.spanId).not.toBe(VALID_SPAN_ID);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(ctx.flags).toBe("01");
    // The wire value MUST reflect this hop's new spanId, not the
    // inbound one. Forwarding the inbound verbatim would make
    // downstream services see THIS hop's parent as their parent,
    // collapsing the trace tree.
    expect(ctx.traceparent).toBe(`00-${VALID_TRACE_ID}-${ctx.spanId}-01`);
  });

  it("originates a fresh trace when no inbound header is present", () => {
    const ctx = buildTraceContext(null);
    expect(ctx.parentSpanId).toBeNull();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(ctx.flags).toBe("00");
    expect(ctx.traceparent).toBe(`00-${ctx.traceId}-${ctx.spanId}-00`);
  });

  it("treats malformed inbound as 'no inbound' and originates a fresh trace", () => {
    // Defensive: a malformed inbound value must not leak partial
    // garbage into our outbound trace id. Better to start a fresh
    // trace than to propagate corrupted state.
    const ctx = buildTraceContext("not-a-real-traceparent");
    expect(ctx.parentSpanId).toBeNull();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("traceContextFromRequest", () => {
  it("reads the traceparent header from a Request", () => {
    const req = new Request("http://localhost/", {
      headers: { [TRACEPARENT_HEADER]: VALID_TRACEPARENT },
    });
    const ctx = traceContextFromRequest(req);
    expect(ctx.traceId).toBe(VALID_TRACE_ID);
    expect(ctx.parentSpanId).toBe(VALID_SPAN_ID);
  });

  it("mints a fresh trace when the header is absent", () => {
    const req = new Request("http://localhost/");
    const ctx = traceContextFromRequest(req);
    expect(ctx.parentSpanId).toBeNull();
  });
});
