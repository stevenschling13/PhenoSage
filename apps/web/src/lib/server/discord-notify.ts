import "server-only";
import { logServerEvent } from "./request-id";

const DISCORD_CONTENT_LIMIT = 2000;

export type DiscordPostOutcome =
  | { kind: "skipped"; reason: "no_webhook_url" }
  | { kind: "sent" }
  | { kind: "failed"; status: number; body: string };

/**
 * POST a plain content message to a Discord channel webhook. Best-effort:
 * a missing DISCORD_WEBHOOK_URL is a soft-skip so dev / preview don't
 * spam the channel and so a deploy without the secret set still boots.
 */
export async function postDiscordMessage(
  content: string,
): Promise<DiscordPostOutcome> {
  const url = process.env["DISCORD_WEBHOOK_URL"];
  if (!url) return { kind: "skipped", reason: "no_webhook_url" };

  const truncated =
    content.length > DISCORD_CONTENT_LIMIT
      ? content.slice(0, DISCORD_CONTENT_LIMIT - 1) + "…"
      : content;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: truncated }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<unreadable>");
      logServerEvent("warn", "discord post failed", {
        status: res.status,
        body: body.slice(0, 200),
      });
      return { kind: "failed", status: res.status, body };
    }
    return { kind: "sent" };
  } catch (error) {
    logServerEvent("warn", "discord post threw", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return { kind: "failed", status: 0, body: String(error) };
  }
}
