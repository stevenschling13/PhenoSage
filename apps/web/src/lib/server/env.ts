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
    name: "GEMINI_API_KEY",
    required: true,
    pattern: /^AIza[0-9A-Za-z_-]{20,}$/,
    hint: "AIza...  (from https://aistudio.google.com/app/apikey)",
  },
  { name: "NEXT_PUBLIC_APP_URL", required: true, pattern: /^https?:\/\// },
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
  const errors: string[] = [];
  for (const rule of rules) {
    const value = env[rule.name];
    if (!value) {
      if (rule.required) {
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
