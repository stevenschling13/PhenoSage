import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { NextRequest } from "next/server";

const postDiscordMessage = vi.fn();

vi.mock("@/lib/server/discord-notify", () => ({
  postDiscordMessage: (...args: unknown[]) => postDiscordMessage(...args),
}));

import { POST } from "../route";
import {
  GITHUB_EVENT_HEADER,
  GITHUB_SIGNATURE_HEADER,
  computeGithubSignature,
} from "@/lib/server/github-signature";

const SECRET = "test-github-webhook-secret-32-bytes-1234";

function buildRequest(
  event: string,
  body: object | string,
  opts: { secret?: string; signature?: string | null } = {},
) {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const useSecret = opts.secret ?? SECRET;
  const sig =
    opts.signature === undefined
      ? computeGithubSignature(rawBody, useSecret)
      : opts.signature;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [GITHUB_EVENT_HEADER]: event,
    "x-github-delivery": "delivery-id-1",
  };
  if (sig) headers[GITHUB_SIGNATURE_HEADER] = sig;
  return new NextRequest("http://localhost/api/internal/webhooks/github", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

describe("POST /api/internal/webhooks/github", () => {
  const originalSecret = process.env["GITHUB_WEBHOOK_SECRET"];

  beforeEach(() => {
    (postDiscordMessage as Mock).mockReset();
    (postDiscordMessage as Mock).mockResolvedValue({ kind: "sent" });
    process.env["GITHUB_WEBHOOK_SECRET"] = SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env["GITHUB_WEBHOOK_SECRET"];
    } else {
      process.env["GITHUB_WEBHOOK_SECRET"] = originalSecret;
    }
  });

  it("returns 503 when the webhook secret is not configured", async () => {
    delete process.env["GITHUB_WEBHOOK_SECRET"];
    const res = await POST(buildRequest("ping", {}, { signature: null }));
    expect(res.status).toBe(503);
  });

  it("returns 401 when the signature is missing", async () => {
    const res = await POST(buildRequest("ping", {}, { signature: null }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the signature was computed with the wrong secret", async () => {
    const res = await POST(
      buildRequest("ping", { zen: "speak less" }, { secret: "other" }),
    );
    expect(res.status).toBe(401);
  });

  it("acks ping without forwarding", async () => {
    const res = await POST(buildRequest("ping", { zen: "speak less" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.forwarded).toBe(false);
    expect(body.data.reason).toBe("ping");
    expect(postDiscordMessage).not.toHaveBeenCalled();
  });

  it("forwards a PR merged into the default branch", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        number: 42,
        title: "Add feature",
        html_url: "https://github.com/o/r/pull/42",
        user: { login: "alice" },
        base: { ref: "main" },
      },
      repository: { default_branch: "main" },
    };
    const res = await POST(buildRequest("pull_request", payload));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.forwarded).toBe(true);
    expect(postDiscordMessage).toHaveBeenCalledTimes(1);
    expect(postDiscordMessage.mock.calls[0]?.[0]).toContain("PR #42 merged");
  });

  it("skips a PR that was closed without merge", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        merged: false,
        number: 42,
        base: { ref: "main" },
      },
      repository: { default_branch: "main" },
    };
    const res = await POST(buildRequest("pull_request", payload));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.forwarded).toBe(false);
    expect(body.data.reason).toBe("pull_request_not_merged");
    expect(postDiscordMessage).not.toHaveBeenCalled();
  });

  it("skips a PR merged to a non-default branch", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        number: 42,
        base: { ref: "develop" },
      },
      repository: { default_branch: "main" },
    };
    const res = await POST(buildRequest("pull_request", payload));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.forwarded).toBe(false);
    expect(body.data.reason).toBe("pull_request_not_default_branch");
  });

  it("forwards a workflow_run failure on the default branch", async () => {
    const payload = {
      action: "completed",
      workflow_run: {
        conclusion: "failure",
        name: "CI",
        html_url: "https://github.com/o/r/actions/runs/1",
        head_branch: "main",
      },
      repository: { default_branch: "main" },
    };
    const res = await POST(buildRequest("workflow_run", payload));
    expect(res.status).toBe(200);
    expect(postDiscordMessage.mock.calls[0]?.[0]).toContain(
      "Workflow failed on `main`",
    );
  });

  it("skips a workflow_run with conclusion=success", async () => {
    const payload = {
      action: "completed",
      workflow_run: {
        conclusion: "success",
        name: "CI",
        head_branch: "main",
      },
      repository: { default_branch: "main" },
    };
    const res = await POST(buildRequest("workflow_run", payload));
    expect(res.status).toBe(200);
    expect(postDiscordMessage).not.toHaveBeenCalled();
  });

  it("skips a workflow_run failure on a feature branch", async () => {
    const payload = {
      action: "completed",
      workflow_run: {
        conclusion: "failure",
        name: "CI",
        head_branch: "feature-x",
      },
      repository: { default_branch: "main" },
    };
    const res = await POST(buildRequest("workflow_run", payload));
    const body = await res.json();
    expect(body.data.reason).toBe("workflow_run_not_default_branch");
    expect(postDiscordMessage).not.toHaveBeenCalled();
  });

  it("forwards a release published event", async () => {
    const payload = {
      action: "published",
      release: {
        tag_name: "v1.2.0",
        html_url: "https://github.com/o/r/releases/tag/v1.2.0",
      },
    };
    const res = await POST(buildRequest("release", payload));
    expect(res.status).toBe(200);
    expect(postDiscordMessage.mock.calls[0]?.[0]).toContain("Release `v1.2.0`");
  });

  it("acks unhandled events without forwarding", async () => {
    const res = await POST(buildRequest("star", { action: "created" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.forwarded).toBe(false);
    expect(body.data.reason).toBe("event_not_handled:star");
    expect(postDiscordMessage).not.toHaveBeenCalled();
  });

  it("reports forwarded=false when Discord skips (no URL configured)", async () => {
    (postDiscordMessage as Mock).mockResolvedValue({
      kind: "skipped",
      reason: "no_webhook_url",
    });
    const payload = {
      action: "published",
      release: {
        tag_name: "v1",
        html_url: "https://github.com/o/r/releases/tag/v1",
      },
    };
    const res = await POST(buildRequest("release", payload));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.forwarded).toBe(false);
    expect(body.data.discord).toBe("skipped");
  });
});
