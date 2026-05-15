import "server-only";

import { Resend } from "resend";

import { logServerEvent } from "./request-id";

// ────────────────────────────────────────────────────────────────────────────
// Configuration + lazy SDK init
// ────────────────────────────────────────────────────────────────────────────

// Module-scope memoised client. Re-instantiating `Resend` per dispatch
// allocates a new HTTP client and reads env on every call; the cron
// processes up to TARGET_USERS_LIMIT users per run, so this matters.
// `null` is the "not yet configured" sentinel; we explicitly distinguish
// it from "tried and failed" so a transient env-read race doesn't lock
// the cron into a no-op.
let cachedClient: Resend | null = null;
let cachedFor: string | null = null;

/**
 * Read the configured API key + sender. Returns `null` when either is
 * missing — the caller MUST treat that as "email is disabled" (no-op +
 * warn log) rather than crashing the cron. The plant-health platform
 * still surfaces the in-app notification even when the email channel
 * is offline, so missing-config is never user-fatal.
 */
function readEmailEnv(): { apiKey: string; from: string } | null {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM_EMAIL"];
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

function getClient(): { client: Resend; from: string } | null {
  const env = readEmailEnv();
  if (!env) return null;
  if (!cachedClient || cachedFor !== env.apiKey) {
    cachedClient = new Resend(env.apiKey);
    cachedFor = env.apiKey;
  }
  return { client: cachedClient, from: env.from };
}

// Test-only: drop the cached client so a test can simulate boot order
// (env first, then re-init). Not exported from any barrel.
export function __resetEmailClientForTests(): void {
  cachedClient = null;
  cachedFor = null;
}

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export interface SendTransactionalEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Idempotency key forwarded to Resend as the `Idempotency-Key`
   * header. Resend dedupes against this for 24h with payload
   * validation; a same-key re-send with a different payload is
   * rejected as a 4xx, which we treat as a logical failure (not a
   * retryable one). Compose this from a stable business event id —
   * for daily summary use `daily-summary:<userId>:<occurredOn>`,
   * for finding alerts use `finding-alert:<findingId>`.
   */
  idempotencyKey: string;
  /**
   * Optional Resend tags for downstream analytics (e.g. open rate by
   * notification kind). Names + values must be ASCII per Resend.
   */
  tags?: { name: string; value: string }[];
}

export type SendTransactionalEmailResult =
  | { ok: true; id: string; deduped?: false }
  | {
      ok: false;
      code:
        | "disabled"
        | "rate_limited"
        | "validation"
        | "auth"
        | "transient"
        | "unknown";
      message: string;
      retryable: boolean;
    };

// ────────────────────────────────────────────────────────────────────────────
// Retry helpers
// ────────────────────────────────────────────────────────────────────────────

// Retry budget. Resend's own SDK does not retry; we add ONE bounded
// retry on transient failures (5xx + 429) per send. The cron runs once
// per day so a longer retry chain would only delay the user-visible
// "your email didn't arrive" failure mode without changing the outcome.
const MAX_RETRIES = 1;
// Cap the server-suggested Retry-After. A misconfigured upstream could
// suggest 24h+; honouring that would tie up the cron's wall-clock
// budget without delivering anything.
const MAX_RETRY_AFTER_MS = 5_000;
const FALLBACK_RETRY_DELAY_MS = 500;

function parseRetryAfter(headers: Record<string, string> | null): number {
  if (!headers) return FALLBACK_RETRY_DELAY_MS;
  // Header is case-insensitive in HTTP but Resend lower-cases the keys.
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  if (!raw) return FALLBACK_RETRY_DELAY_MS;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds < 0) return FALLBACK_RETRY_DELAY_MS;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

type SendErrorCode =
  | "disabled"
  | "rate_limited"
  | "validation"
  | "auth"
  | "transient"
  | "unknown";

function classifyError(statusCode: number | null): {
  code: SendErrorCode;
  retryable: boolean;
} {
  if (statusCode === 429) return { code: "rate_limited", retryable: true };
  if (statusCode === 401 || statusCode === 403)
    return { code: "auth", retryable: false };
  if (statusCode !== null && statusCode >= 500)
    return { code: "transient", retryable: true };
  if (statusCode !== null && statusCode >= 400)
    return { code: "validation", retryable: false };
  return { code: "unknown", retryable: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Send a transactional email through Resend. Never throws — always
 * returns a typed Result so the caller (cron, alert pipeline) can log
 * + move on without breaking the user-facing flow.
 *
 * Behaviour:
 *   * If `RESEND_API_KEY` or `RESEND_FROM_EMAIL` is unset, returns
 *     `{ ok: false, code: 'disabled' }` and logs at `warn` level once
 *     per process.
 *   * Forwards `idempotencyKey` as Resend's native `Idempotency-Key`
 *     header (24h dedupe with payload validation).
 *   * Retries ONCE on transient failures (5xx + 429), honouring the
 *     server's `Retry-After` header (clamped to MAX_RETRY_AFTER_MS).
 *   * Does NOT retry on 4xx — those are validation / auth failures
 *     that won't change on a re-attempt.
 */
export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput,
): Promise<SendTransactionalEmailResult> {
  const config = getClient();
  if (!config) {
    logServerEvent("warn", "email: dispatch skipped, RESEND_API_KEY not set", {
      idempotencyKey: input.idempotencyKey,
    });
    return {
      ok: false,
      code: "disabled",
      message: "Email delivery is not configured.",
      retryable: false,
    };
  }

  let lastResult: SendTransactionalEmailResult | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Awaited<ReturnType<typeof config.client.emails.send>>;
    try {
      response = await config.client.emails.send(
        {
          from: config.from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
          ...(input.tags ? { tags: input.tags } : {}),
        },
        { idempotencyKey: input.idempotencyKey },
      );
    } catch (err) {
      // Network-level failure (DNS, TLS, abort). Retry once.
      logServerEvent("error", "email: dispatch network error", {
        idempotencyKey: input.idempotencyKey,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
      lastResult = {
        ok: false,
        code: "transient",
        message: "Email provider is temporarily unreachable.",
        retryable: true,
      };
      if (attempt < MAX_RETRIES) {
        await sleep(FALLBACK_RETRY_DELAY_MS);
        continue;
      }
      return lastResult;
    }

    if (response.error) {
      const classified = classifyError(response.error.statusCode);
      lastResult = {
        ok: false,
        code: classified.code,
        message: response.error.message,
        retryable: classified.retryable,
      };
      logServerEvent(
        classified.retryable ? "warn" : "error",
        `email: dispatch failed (${classified.code})`,
        {
          idempotencyKey: input.idempotencyKey,
          attempt,
          statusCode: response.error.statusCode,
          providerName: response.error.name,
        },
      );
      if (classified.retryable && attempt < MAX_RETRIES) {
        await sleep(parseRetryAfter(response.headers));
        continue;
      }
      return lastResult;
    }

    if (!response.data?.id) {
      // Resend returned 2xx but no id — treat as unknown failure;
      // do not retry (we have no idea whether it sent).
      logServerEvent("error", "email: dispatch returned no id", {
        idempotencyKey: input.idempotencyKey,
      });
      return {
        ok: false,
        code: "unknown",
        message: "Email provider returned a malformed response.",
        retryable: false,
      };
    }

    return { ok: true, id: response.data.id };
  }

  return (
    lastResult ?? {
      ok: false,
      code: "unknown",
      message: "Email dispatch exhausted retries.",
      retryable: false,
    }
  );
}
