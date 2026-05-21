/**
 * Runtime env validation for PhenoSage web.
 *
 * Kept dependency-free on purpose — adding zod to a Next.js app has
 * significant bundle cost once imported from a client-reachable module.
 * This validator runs on the server only.
 *
 * Call `assertServerEnv()` at the top of a server entry (e.g. a Route
 * Handler) when you want a loud failure on misconfiguration. Prefer
 * importing the typed `publicEnv` object in client/shared code.
 */

type Rule = {
  name: string;
  required: boolean;
  /**
   * When set, this rule is also treated as `required` whenever
   * `NEXT_PUBLIC_APP_ENV === "production"`. Used for variables that
   * are optional in dev/preview (so contributors don't have to set
   * them) but mandatory in prod (so the deploy fails fast on the
   * platform health check rather than silently in user traffic).
   */
  requiredInProduction?: boolean;
  pattern?: RegExp;
  hint?: string;
};

const SERVER_RULES: Rule[] = [
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    required: true,
    pattern: /^https:\/\/[^/]+\.supabase\.(co|in)(\/|$)/,
    hint: "https://<project-ref>.supabase.co",
  },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true },
  {
    name: "ANALYSIS_SERVICE_URL",
    required: true,
    pattern: /^https?:\/\//,
    hint: "https://<service>.railway.app",
  },
  { name: "ANALYSIS_SERVICE_API_KEY", required: true },
  {
    // Shared HMAC secret the analysis service uses to sign
    // /api/internal/webhooks/analysis-complete callbacks. Optional in
    // dev/preview (the synchronous /analyze path still works without
    // it); required in production so async job completions can't be
    // spoofed by an attacker who guesses the route.
    name: "ANALYSIS_WEBHOOK_SECRET",
    required: false,
    requiredInProduction: true,
    hint: "32+ byte random hex; must match the analysis service",
  },
  {
    // Shared bearer token used to authenticate Supabase Database
    // Webhooks posted to /api/internal/webhooks/auth/user-created.
    // Supabase only supports static headers on Database Webhooks, so
    // this is a long-lived secret rotated out-of-band rather than an
    // HMAC per request. Optional in dev/preview; required in
    // production where signups actually fire callbacks.
    name: "SUPABASE_AUTH_WEBHOOK_SECRET",
    required: false,
    requiredInProduction: true,
    hint: "32+ byte random hex; must match the Supabase Database Webhook header",
  },
  {
    // Shared bearer for Supabase Database Webhooks posted to
    // /api/internal/webhooks/storage/image-uploaded. Auto-analyze on
    // upload is the production behavior; optional in dev/preview where
    // an operator may not want every test upload to burn quota.
    name: "SUPABASE_STORAGE_WEBHOOK_SECRET",
    required: false,
    requiredInProduction: true,
    hint: "32+ byte random hex; must match the storage.objects Database Webhook header",
  },
  {
    name: "GEMINI_API_KEY",
    required: true,
    pattern: /^AIza[0-9A-Za-z_-]{20,}$/,
    hint: "AIza...  (from https://aistudio.google.com/app/apikey)",
  },
  { name: "NEXT_PUBLIC_APP_URL", required: true, pattern: /^https?:\/\// },
  {
    // Optional in dev/preview, REQUIRED in production. Without a DSN the
    // app would deploy successfully but operate blind — no crash reports,
    // no perf traces, no error-rate dashboards. The cost of letting
    // production go dark is much higher than the cost of failing the
    // deploy. Hint matches the public DSN shape Sentry issues
    // (`https://<key>@<orgId>.ingest.sentry.io/<projectId>`).
    name: "SENTRY_DSN",
    required: false,
    requiredInProduction: true,
    pattern: /^https:\/\/[^@/]+@[^/]+\/[0-9]+$/,
    hint: "https://<publicKey>@<orgId>.ingest.sentry.io/<projectId>",
  },
];

const PUBLIC_RULES: Rule[] = SERVER_RULES.filter((r) =>
  r.name.startsWith("NEXT_PUBLIC_"),
);

export class EnvValidationError extends Error {
  constructor(public readonly violations: string[]) {
    super(`Invalid environment:\n  - ${violations.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

function validate(rules: Rule[], env: NodeJS.ProcessEnv): string[] {
  // "production" gating is opt-in via the public APP_ENV var so that
  // VERCEL_ENV / NODE_ENV quirks (Vercel preview deploys both have
  // NODE_ENV=production at build time) can't accidentally trigger
  // strict checks where they aren't intended.
  const isProduction = env["NEXT_PUBLIC_APP_ENV"] === "production";
  const errors: string[] = [];
  for (const rule of rules) {
    const value = env[rule.name];
    const effectivelyRequired =
      rule.required || (isProduction && rule.requiredInProduction === true);
    if (!value) {
      if (effectivelyRequired) {
        errors.push(
          `${rule.name} is required${rule.hint ? ` (e.g. ${rule.hint})` : ""}`,
        );
      }
      continue;
    }
    if (rule.pattern && !rule.pattern.test(value)) {
      errors.push(
        `${rule.name} is malformed${rule.hint ? ` (expected ${rule.hint})` : ""}`,
      );
    }
  }
  return errors;
}

export function assertServerEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors = validate(SERVER_RULES, env);
  if (errors.length) throw new EnvValidationError(errors);
}

export function assertPublicEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors = validate(PUBLIC_RULES, env);
  if (errors.length) throw new EnvValidationError(errors);
}

export function getServerEnvErrors(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return validate(SERVER_RULES, env);
}
