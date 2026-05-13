import { NextResponse } from "next/server";

// Public diagnostic endpoint for the chat subsystem.
//
// Returns ONLY:
//   * The build SHA the running deployment was compiled from (so an operator
//     can verify which commit is live without needing Vercel dashboard access).
//   * Boolean presence of each Gemini-key alias the chat route accepts.
//   * The list of env variable NAMES (never values) that look like AI / API
//     credentials. This is identical to what the top-level chat error catch
//     surfaces on `ai_unconfigured`, but available without having to provoke
//     a 500 from the chat route. Names are already documented publicly in
//     `.env.example`, so listing them does not leak secrets.
//
// This endpoint is intentionally unauthenticated so the operator can hit it
// from any browser tab — including the user-facing app — to instantly
// confirm whether the deployment they are talking to has the Gemini key set.
// No values are ever returned.
export const dynamic = "force-dynamic";

const NEEDLE =
  /(GEMINI|GOOGLE|OPENAI|ANTHROPIC|VERTEX|AI[_-]?KEY|API[_-]?KEY)/i;
const SAFE_TO_LIST = /^[A-Z][A-Z0-9_]{2,80}$/;

function listAiEnvNames(): string[] {
  return Object.keys(process.env)
    .filter(
      (k) =>
        SAFE_TO_LIST.test(k) &&
        NEEDLE.test(k) &&
        typeof process.env[k] === "string" &&
        (process.env[k] as string).length > 0,
    )
    .sort();
}

export async function GET() {
  const buildSha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    "unknown";
  const buildShaShort = buildSha.slice(0, 7);
  const aliases = {
    GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
    GOOGLE_GENERATIVE_AI_API_KEY: Boolean(
      process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    ),
    GOOGLE_API_KEY: Boolean(process.env.GOOGLE_API_KEY),
  } as const;
  const anyAliasSet = Object.values(aliases).some(Boolean);
  const aiEnvInventory = listAiEnvNames();
  return NextResponse.json(
    {
      ok: anyAliasSet,
      buildSha,
      buildShaShort,
      aliases,
      aiEnvInventory,
      hint: anyAliasSet
        ? "At least one Gemini key alias is set. If chat still fails the cause is downstream (model quota, network, db)."
        : "No Gemini key alias is set on this deployment's runtime. Add GEMINI_API_KEY (or one of the accepted aliases) under Vercel → Settings → Environment Variables → Production, then redeploy.",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
