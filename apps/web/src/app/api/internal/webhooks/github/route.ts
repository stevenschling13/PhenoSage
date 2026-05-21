import { NextRequest } from "next/server";

import { apiError, apiSuccess } from "@/lib/server/api-errors";
import { postDiscordMessage } from "@/lib/server/discord-notify";
import {
  GITHUB_DELIVERY_HEADER,
  GITHUB_EVENT_HEADER,
  GITHUB_SIGNATURE_HEADER,
  verifyGithubSignature,
} from "@/lib/server/github-signature";
import { getOrCreateRequestId, logServerEvent } from "@/lib/server/request-id";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/internal/webhooks/github
//
// Receives GitHub webhook deliveries and forwards a compact summary to
// the Discord channel webhook configured via DISCORD_WEBHOOK_URL.
// Filters to a small allowlist of high-signal events so the channel
// doesn't drown in noise:
//
//   * pull_request "closed" with `merged: true` on the default branch
//   * workflow_run "completed" with `conclusion: failure` on the
//     default branch
//   * release "published"
//
// Everything else is ack'd with 200 but skipped — GitHub will stop
// retrying on 200. Auth is HMAC-SHA256 over the raw body keyed by
// GITHUB_WEBHOOK_SECRET (the standard X-Hub-Signature-256 scheme).
//
// The string `GITHUB_WEBHOOK_SECRET` must appear in this file for the
// scripts/check-route-security.mjs guardrail.

type ForwardOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "sent"; summary: string };

function summarize(
  event: string,
  payload: Record<string, unknown>,
): ForwardOutcome {
  if (event === "ping") return { kind: "skipped", reason: "ping" };

  if (event === "pull_request") {
    const action = payload["action"];
    const pr = payload["pull_request"] as Record<string, unknown> | undefined;
    const repo = payload["repository"] as Record<string, unknown> | undefined;
    if (action !== "closed" || !pr || pr["merged"] !== true || !repo) {
      return { kind: "skipped", reason: "pull_request_not_merged" };
    }
    const defaultBranch = (repo["default_branch"] as string) ?? "main";
    const base = pr["base"] as Record<string, unknown> | undefined;
    if (!base || base["ref"] !== defaultBranch) {
      return { kind: "skipped", reason: "pull_request_not_default_branch" };
    }
    const num = pr["number"];
    const title = pr["title"];
    const url = pr["html_url"];
    const author = (pr["user"] as Record<string, unknown> | undefined)?.[
      "login"
    ];
    return {
      kind: "sent",
      summary: `:rocket: **PR #${num} merged** by \`${author}\` — ${title}\n${url}`,
    };
  }

  if (event === "workflow_run") {
    const action = payload["action"];
    const run = payload["workflow_run"] as Record<string, unknown> | undefined;
    const repo = payload["repository"] as Record<string, unknown> | undefined;
    if (
      action !== "completed" ||
      !run ||
      run["conclusion"] !== "failure" ||
      !repo
    ) {
      return { kind: "skipped", reason: "workflow_run_not_failure" };
    }
    const defaultBranch = (repo["default_branch"] as string) ?? "main";
    if (run["head_branch"] !== defaultBranch) {
      return { kind: "skipped", reason: "workflow_run_not_default_branch" };
    }
    const name = run["name"];
    const url = run["html_url"];
    return {
      kind: "sent",
      summary: `:rotating_light: **Workflow failed on \`${defaultBranch}\`**: ${name}\n${url}`,
    };
  }

  if (event === "release") {
    const action = payload["action"];
    const release = payload["release"] as Record<string, unknown> | undefined;
    if (action !== "published" || !release) {
      return { kind: "skipped", reason: "release_not_published" };
    }
    const tag = release["tag_name"];
    const url = release["html_url"];
    return {
      kind: "sent",
      summary: `:package: **Release \`${tag}\` published**\n${url}`,
    };
  }

  return { kind: "skipped", reason: `event_not_handled:${event}` };
}

export async function POST(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);

  const secret = process.env["GITHUB_WEBHOOK_SECRET"];
  if (!secret) {
    logServerEvent("error", "github webhook: secret not configured", {
      requestId,
    });
    return apiError(
      503,
      "CONFIGURATION_ERROR",
      "Webhook receiver not configured",
      requestId,
    );
  }

  // Read raw body BEFORE parsing JSON so the HMAC matches what GitHub
  // signed. JSON.stringify(JSON.parse(raw)) is not byte-identical to
  // `raw` and would always fail verification.
  const rawBody = await request.text();
  const verdict = verifyGithubSignature({
    rawBody,
    signatureHeader: request.headers.get(GITHUB_SIGNATURE_HEADER),
    secret,
  });
  if (!verdict.ok) {
    logServerEvent("warn", "github webhook: signature rejected", {
      requestId,
      reason: verdict.reason,
    });
    return apiError(401, "UNAUTHORIZED", "Invalid signature", requestId);
  }

  const event = request.headers.get(GITHUB_EVENT_HEADER) ?? "unknown";
  const delivery = request.headers.get(GITHUB_DELIVERY_HEADER) ?? "unknown";

  let payload: Record<string, unknown>;
  try {
    payload = rawBody.length === 0 ? {} : (JSON.parse(rawBody) ?? {});
  } catch {
    return apiError(400, "BAD_REQUEST", "Invalid JSON body", requestId);
  }

  const outcome = summarize(event, payload);
  if (outcome.kind === "skipped") {
    logServerEvent("info", "github webhook: event skipped", {
      requestId,
      event,
      delivery,
      reason: outcome.reason,
    });
    return apiSuccess(
      200,
      { event, delivery, forwarded: false, reason: outcome.reason },
      requestId,
    );
  }

  const discordResult = await postDiscordMessage(outcome.summary);
  logServerEvent("info", "github webhook: event forwarded", {
    requestId,
    event,
    delivery,
    discord: discordResult.kind,
  });
  return apiSuccess(
    200,
    {
      event,
      delivery,
      forwarded: discordResult.kind === "sent",
      discord: discordResult.kind,
    },
    requestId,
  );
}
