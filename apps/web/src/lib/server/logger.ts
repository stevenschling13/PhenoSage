import "server-only";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SECRET_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "openai_api_key",
  "supabase_service_role_key",
  "analysis_service_api_key",
  "cron_secret",
  "apikey",
  "api_key",
  "token",
  "password",
]);

function currentLevel(): Level {
  const raw = (process.env["LOG_LEVEL"] ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") {
    if (value.startsWith("sk-") || value.startsWith("eyJ")) return "[redacted]";
    return value.length > 2_000 ? value.slice(0, 2_000) + "…" : value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k.toLowerCase())) {
        out[k] = "[redacted]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

function emit(level: Level, message: string, fields: Record<string, unknown>) {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel()]) return;
  const record = {
    level,
    msg: message,
    ts: new Date().toISOString(),
    ...(redact(fields) as Record<string, unknown>),
  };
  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    // eslint-disable-next-line no-console -- structured logger is the last step in the write path
    console.log(line);
  }
}

export interface Logger {
  debug: (_msg: string, _fields?: Record<string, unknown>) => void;
  info: (_msg: string, _fields?: Record<string, unknown>) => void;
  warn: (_msg: string, _fields?: Record<string, unknown>) => void;
  error: (_msg: string, _fields?: Record<string, unknown>) => void;
  child: (_fields: Record<string, unknown>) => Logger;
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  return {
    debug(msg, fields = {}) {
      emit("debug", msg, { ...base, ...fields });
    },
    info(msg, fields = {}) {
      emit("info", msg, { ...base, ...fields });
    },
    warn(msg, fields = {}) {
      emit("warn", msg, { ...base, ...fields });
    },
    error(msg, fields = {}) {
      emit("error", msg, { ...base, ...fields });
    },
    child(fields) {
      return createLogger({ ...base, ...fields });
    },
  };
}

/**
 * Extract or mint a correlation ID for a request.
 * Honors an existing `x-request-id` header so callers can stitch traces together.
 */
export function correlationIdFromRequest(request: Request): string {
  const existing = request.headers.get("x-request-id");
  if (existing && existing.length <= 128) return existing;
  return cryptoRandomId();
}

function cryptoRandomId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `req_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
