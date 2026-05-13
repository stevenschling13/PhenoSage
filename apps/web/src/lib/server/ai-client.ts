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
export function getAIClient(): OpenAI {
  if (!client) {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY");
    }
    client = new OpenAI({
      apiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  }
  return client;
}
