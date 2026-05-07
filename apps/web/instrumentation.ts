export async function register() {
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
