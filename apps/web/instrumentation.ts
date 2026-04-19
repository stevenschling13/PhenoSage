/**
 * Next.js instrumentation hook.
 *
 * This file is imported by Next.js once per server process. Keep it side-effect
 * free aside from telemetry bootstrapping. Every integration is gated behind an
 * env var so local dev / CI / preview deploys stay no-op by default.
 *
 * Supported backends:
 *   - Sentry (SENTRY_DSN). Optional and dynamically imported so the package is
 *     only loaded when actually configured.
 *
 * `onRequestError` forwards unhandled request errors to whatever backend is
 * configured. When nothing is configured it falls back to a structured stderr
 * log so failures remain diagnosable.
 */

interface SentryModule {
  init: (_opts: Record<string, unknown>) => void;
  captureException: (_err: unknown, _ctx?: Record<string, unknown>) => void;
}

async function loadSentry(): Promise<SentryModule | null> {
  // Resolve the specifier via a runtime variable so tsc does not try to type
  // the module at build time. @sentry/nextjs is an optional peer.
  const specifier = "@sentry/nextjs";
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as SentryModule;
    return mod ?? null;
  } catch {
    return null;
  }
}

export async function register(): Promise<void> {
  const dsn = process.env["SENTRY_DSN"];
  if (!dsn) return;

  try {
    // Only import when DSN is configured; keeps bundle + boot cost at zero for
    // environments that haven't opted into Sentry. The package is optional and
    // intentionally untyped here so the project still type-checks without it.
    const mod = (await loadSentry()) as SentryModule | null;
    if (!mod?.init) return;

    mod.init({
      dsn,
      environment:
        process.env["NEXT_PUBLIC_APP_ENV"] ?? process.env["NODE_ENV"],
      release:
        process.env["VERCEL_GIT_COMMIT_SHA"] ??
        process.env["GIT_COMMIT_SHA"] ??
        undefined,
      tracesSampleRate: Number(
        process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0.1",
      ),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "instrumentation.register failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

interface RequestContext {
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined> | Headers;
}

export async function onRequestError(
  error: unknown,
  request: RequestContext,
  context: { routerKind?: string; routePath?: string; routeType?: string },
): Promise<void> {
  const dsn = process.env["SENTRY_DSN"];
  const headers = request.headers;
  const requestId =
    headers instanceof Headers
      ? headers.get("x-request-id")
      : typeof headers === "object"
        ? ((headers?.["x-request-id"] as string | undefined) ?? null)
        : null;

  if (dsn) {
    try {
      const mod = (await loadSentry()) as SentryModule | null;
      if (mod?.captureException) {
        mod.captureException(error, {
          tags: {
            request_id: requestId ?? "unknown",
            route_kind: context.routerKind ?? "unknown",
            route_type: context.routeType ?? "unknown",
          },
          extra: { routePath: context.routePath, path: request.path },
        });
        return;
      }
    } catch {
      // fall through to stderr logging
    }
  }

  const record = {
    level: "error",
    msg: "next.request_error",
    ts: new Date().toISOString(),
    request_id: requestId,
    path: request.path,
    method: request.method,
    route_kind: context.routerKind,
    route_type: context.routeType,
    route_path: context.routePath,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
  };
  console.error(JSON.stringify(record));
}
