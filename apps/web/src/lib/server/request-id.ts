import "server-only";

export const REQUEST_ID_HEADER = "x-request-id";

type LogLevel = "error" | "info" | "warn";

export function getOrCreateRequestId(request: Request): string {
  const candidate = request.headers.get(REQUEST_ID_HEADER)?.trim();
  return candidate || crypto.randomUUID();
}

export function withRequestIdHeader(
  headersInit: HeadersInit | undefined,
  requestId: string,
): Headers {
  const headers = new Headers(headersInit);
  headers.set(REQUEST_ID_HEADER, requestId);
  return headers;
}

export function attachRequestId<T extends Response>(
  response: T,
  requestId: string,
): T {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function logServerEvent(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const payload = {
    level,
    message,
    service: "phenosage-web",
    timestamp: new Date().toISOString(),
    ...fields,
  };
  const serialized = JSON.stringify(payload);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  process.stdout.write(`${serialized}\n`);
}
