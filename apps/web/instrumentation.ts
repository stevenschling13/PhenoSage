import { registerOTel } from "@vercel/otel";

export async function register() {
  // 1. OpenTelemetry trace propagation.
  //
  // Wires Next.js's underlying OTel runtime so outgoing `fetch()` calls to
  // the analysis service carry a W3C `traceparent` header. The analysis
  // service already reads `traceparent` (see apps/analysis/app/telemetry.py)
  // so spans on both sides correlate end-to-end without anyone having to
  // copy trace IDs by hand.
  //
  // Graceful skip when `ANALYSIS_SERVICE_URL` is unset — local dev runs
  // without the analysis service and we shouldn't fail boot for that.
  const analysisUrl = process.env["ANALYSIS_SERVICE_URL"]?.trim();
  const otelEnabled =
    (process.env["OTEL_ENABLED"] ?? "").toLowerCase() === "true";
  if (analysisUrl || otelEnabled) {
    try {
      registerOTel({
        serviceName: process.env["OTEL_SERVICE_NAME"] ?? "phenosage-web",
        ...(analysisUrl
          ? {
              instrumentationConfig: {
                fetch: { propagateContextUrls: [analysisUrl] },
              },
            }
          : {}),
      });
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "web OTel register skipped",
          service: "phenosage-web",
          reason: error instanceof Error ? error.message : "unknown_error",
        }),
      );
    }
  }

  // 2. Sentry. Optional — only initializes when SENTRY_DSN is set and the
  // @sentry/nextjs package is installed. Dynamic import keeps this file
  // friendly to deployments that haven't adopted Sentry yet.
  const dsn = process.env["SENTRY_DSN"]?.trim();
  if (!dsn) {
    return;
  }

  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (_specifier: string) => Promise<{
      init?: (_options: Record<string, unknown>) => void;
    }>;
    const sentry = await dynamicImport("@sentry/nextjs");
    sentry.init?.({
      dsn,
      enabled: true,
      tracesSampleRate: Number(
        process.env["SENTRY_TRACES_SAMPLE_RATE"] ?? "0.1",
      ),
      environment:
        process.env["NEXT_PUBLIC_APP_ENV"] ?? process.env.NODE_ENV ?? "unknown",
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "web instrumentation init skipped",
        service: "phenosage-web",
        reason: error instanceof Error ? error.message : "unknown_error",
      }),
    );
  }
}
