import "server-only";
import { rateLimit } from "./rate-limit";
import { logServerEvent } from "./request-id";

// Per-tool rate limits keyed on `(userId|anonymous, toolName)`. The
// chat route already enforces a generic ceiling on the whole turn
// (~30/min/user, see /api/chat/route.ts); this is a defence-in-depth
// budget that throttles the expensive tools specifically, so a single
// runaway prompt can't fan out N analysis calls inside one turn.
//
// Tools not listed inherit no per-tool cap. Limits expressed as
// `{ limit, windowMs }` for the sliding-window backend.
export const PER_TOOL_RATE_LIMITS: Record<
  string,
  { limit: number; windowMs: number }
> = {
  // Hits Gemini + Supabase writes; expensive and slow.
  trigger_plant_analysis: { limit: 6, windowMs: 60_000 },
  // Bulk insert with auto-numbered names; bounded but worth capping.
  create_plants: { limit: 10, windowMs: 60_000 },
  // Wallet-spending writes worth capping per minute.
  create_grow: { limit: 10, windowMs: 60_000 },
  record_image_finding: { limit: 20, windowMs: 60_000 },
  // Embeds a query with Gemini, then performs a vector RPC.
  search_similar_findings: { limit: 20, windowMs: 60_000 },
};

export type RateLimitToolResult = { ok: true } | { ok: false; error: string };

export type RateLimitToolContext = {
  userId: string | null;
  requestId: string;
};

// Returns { ok: true } when the call is permitted (either no policy
// configured for the tool, or the budget hasn't been exhausted).
// Returns { ok: false, error } with a user-readable retry hint when
// the budget IS exhausted.
export async function checkPerToolRateLimit(
  toolName: string,
  ctx: RateLimitToolContext,
): Promise<RateLimitToolResult> {
  const policy = PER_TOOL_RATE_LIMITS[toolName];
  if (!policy) return { ok: true };
  const subject = ctx.userId ?? "anonymous";
  const result = await rateLimit({
    key: `chat-tool:${toolName}:${subject}`,
    limit: policy.limit,
    windowMs: policy.windowMs,
  });
  if (!result.ok) {
    logServerEvent("warn", "chat tool rate-limited", {
      requestId: ctx.requestId,
      userId: ctx.userId,
      tool: toolName,
      resetAt: result.resetAt,
    });
    const retryInSec = Math.max(
      1,
      Math.ceil((result.resetAt - Date.now()) / 1000),
    );
    return {
      ok: false,
      error: `rate limit: too many ${toolName} calls in a row; retry in ~${retryInSec}s`,
    };
  }
  return { ok: true };
}
