import "server-only";
import OpenAI from "openai";

let client: OpenAI | null = null;

/**
 * Returns a singleton AI client.
 *
 * We use the official `openai` SDK but point it at Google Gemini's
 * OpenAI-compatible endpoint, so the SDK shape (chat.completions.stream,
 * tool calls, message format) stays identical while the actual model is
 * Gemini. This lets the chat route stay on free Gemini quota without
 * any client-side or routing changes.
 *
 * Server-side only — the API key must never reach the browser.
 *
 * @see https://ai.google.dev/gemini-api/docs/openai
 */
// We accept several conventional env-var names for the same Google Gemini
// API key so the operator doesn't have to know which one our code reads.
// Order of precedence:
//   1. GEMINI_API_KEY                  — Google AI Studio default
//   2. GOOGLE_GENERATIVE_AI_API_KEY    — Vercel AI SDK convention
//   3. GOOGLE_API_KEY                  — generic Google Cloud
// Whichever is set first wins; absence of all three is the only failure.
const GEMINI_KEY_ENV_NAMES = [
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_API_KEY",
] as const;

function readGeminiApiKey(): string | undefined {
  for (const name of GEMINI_KEY_ENV_NAMES) {
    const v = process.env[name];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function getAIClient(): OpenAI {
  if (!client) {
    const apiKey = readGeminiApiKey();
    if (!apiKey) {
      // Name every accepted variable so the operator can fix without
      // having to read the source. The classifier in the chat route
      // matches /GEMINI_API_KEY/ so this still maps to ai_unconfigured.
      throw new Error(
        `Missing GEMINI_API_KEY (also accepted: ${GEMINI_KEY_ENV_NAMES.slice(1).join(", ")})`,
      );
    }
    client = new OpenAI({
      apiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  }
  return client;
}
