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

const enqueueAnalysisJobByStoragePath = vi.fn();

vi.mock("@/lib/server/analysis-jobs", () => ({
  enqueueAnalysisJobByStoragePath: (...args: unknown[]) =>
    enqueueAnalysisJobByStoragePath(...args),
}));

import { POST } from "../route";

const SECRET = "test-storage-bearer-token-32-bytes-1234567";
const STORAGE_PATH = "11111111-1111-4111-8111-111111111111/abc.jpg";

function envelope(opts: { bucket?: string; name?: string } = {}) {
  return {
    type: "INSERT" as const,
    table: "objects" as const,
    schema: "storage" as const,
    record: {
      name: opts.name ?? STORAGE_PATH,
      bucket_id: opts.bucket ?? "plant-images",
    },
  };
}

function buildRequest(body: unknown, opts: { bearer?: string | null } = {}) {
  const bearer = opts.bearer === undefined ? SECRET : opts.bearer;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  return new NextRequest(
    "http://localhost/api/internal/webhooks/storage/image-uploaded",
    {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

describe("POST /api/internal/webhooks/storage/image-uploaded", () => {
  const originalSecret = process.env["SUPABASE_STORAGE_WEBHOOK_SECRET"];

  beforeEach(() => {
    (enqueueAnalysisJobByStoragePath as Mock).mockReset();
    process.env["SUPABASE_STORAGE_WEBHOOK_SECRET"] = SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env["SUPABASE_STORAGE_WEBHOOK_SECRET"];
    } else {
      process.env["SUPABASE_STORAGE_WEBHOOK_SECRET"] = originalSecret;
    }
  });

  it("returns 503 when the webhook secret is not configured", async () => {
    delete process.env["SUPABASE_STORAGE_WEBHOOK_SECRET"];
    const res = await POST(buildRequest(envelope(), { bearer: null }));
    expect(res.status).toBe(503);
    expect(enqueueAnalysisJobByStoragePath).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer header is missing", async () => {
    const res = await POST(buildRequest(envelope(), { bearer: null }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the bearer is wrong", async () => {
    const res = await POST(buildRequest(envelope(), { bearer: "nope" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const res = await POST(buildRequest("not-json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when payload has no storage path", async () => {
    const res = await POST(buildRequest({ unrelated: true }));
    expect(res.status).toBe(400);
  });

  it("ignores objects from other buckets without enqueueing", async () => {
    const res = await POST(buildRequest(envelope({ bucket: "avatars" })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enqueued).toBe(false);
    expect(body.data.reason).toBe("ignored_bucket");
    expect(enqueueAnalysisJobByStoragePath).not.toHaveBeenCalled();
  });

  it("returns 200 with image_not_found when no plant_images row matches", async () => {
    enqueueAnalysisJobByStoragePath.mockResolvedValue({
      kind: "image_not_found",
      storagePath: STORAGE_PATH,
    });
    const res = await POST(buildRequest(envelope()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enqueued).toBe(false);
    expect(body.data.reason).toBe("image_not_found");
  });

  it("returns 200 with rate_limited when the per-user analysis cap is hit", async () => {
    const resetAt = Date.now() + 30 * 60 * 1000;
    enqueueAnalysisJobByStoragePath.mockResolvedValue({
      kind: "rate_limited",
      userId: "user-1",
      resetAt,
    });
    const res = await POST(buildRequest(envelope()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enqueued).toBe(false);
    expect(body.data.reason).toBe("rate_limited");
    expect(body.data.reset_at).toBe(resetAt);
  });

  it("enqueues an analysis job for a matching plant_images row", async () => {
    enqueueAnalysisJobByStoragePath.mockResolvedValue({
      kind: "enqueued",
      job: { id: "job-99", status: "queued" },
    });
    const res = await POST(buildRequest(envelope()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enqueued).toBe(true);
    expect(body.data.job_id).toBe("job-99");
    expect(body.data.job_status).toBe("queued");
    expect(enqueueAnalysisJobByStoragePath).toHaveBeenCalledWith({
      storagePath: STORAGE_PATH,
    });
  });

  it("accepts the flat { storage_path, bucket } payload", async () => {
    enqueueAnalysisJobByStoragePath.mockResolvedValue({
      kind: "enqueued",
      job: { id: "job-99", status: "queued" },
    });
    const res = await POST(
      buildRequest({ storage_path: STORAGE_PATH, bucket: "plant-images" }),
    );
    expect(res.status).toBe(200);
    expect(enqueueAnalysisJobByStoragePath).toHaveBeenCalledWith({
      storagePath: STORAGE_PATH,
    });
  });

  it("accepts a flat payload without a bucket (local testing)", async () => {
    enqueueAnalysisJobByStoragePath.mockResolvedValue({
      kind: "enqueued",
      job: { id: "job-99", status: "queued" },
    });
    const res = await POST(buildRequest({ storage_path: STORAGE_PATH }));
    expect(res.status).toBe(200);
  });

  it("returns 500 when enqueue throws", async () => {
    enqueueAnalysisJobByStoragePath.mockRejectedValue(new Error("db down"));
    const res = await POST(buildRequest(envelope()));
    expect(res.status).toBe(500);
  });
});
