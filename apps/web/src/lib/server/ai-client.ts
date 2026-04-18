import "server-only";
import OpenAI from "openai";

let client: OpenAI | null = null;

/**
 * Returns a singleton OpenAI client.
 * Server-side only — the API key must never reach the browser.
 */
export function getAIClient(): OpenAI {
  if (!client) {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}
