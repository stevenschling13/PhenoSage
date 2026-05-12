import { describe, expect, it } from "vitest";
import {
  AnalysisJobStatusSchema,
  AnalyzeRequestSchema,
  ApiErrorSchema,
  ChatRequestSchema,
  UploadFinalizeRequestSchema,
  UploadSignRequestSchema,
  UuidSchema,
} from "../schemas";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("UuidSchema", () => {
  it("accepts a valid v4 uuid", () => {
    expect(UuidSchema.safeParse(UUID).success).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    expect(UuidSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("UploadSignRequestSchema", () => {
  it("accepts a well-formed request", () => {
    const r = UploadSignRequestSchema.safeParse({
      plantId: UUID,
      fileName: "leaf.png",
      contentType: "image/png",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unsupported contentType", () => {
    const r = UploadSignRequestSchema.safeParse({
      plantId: UUID,
      fileName: "evil.gif",
      contentType: "image/gif",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty fileName", () => {
    const r = UploadSignRequestSchema.safeParse({
      plantId: UUID,
      fileName: "",
      contentType: "image/png",
    });
    expect(r.success).toBe(false);
  });

  it("rejects fileName over 255 chars", () => {
    const r = UploadSignRequestSchema.safeParse({
      plantId: UUID,
      fileName: "x".repeat(256),
      contentType: "image/png",
    });
    expect(r.success).toBe(false);
  });

  it("accepts optional fields", () => {
    const r = UploadSignRequestSchema.safeParse({
      plantId: UUID,
      fileName: "leaf.png",
      contentType: "image/jpeg",
      takenAt: "2026-05-12T15:00:00.000Z",
      source: "camera",
      notes: "morning canopy shot",
    });
    expect(r.success).toBe(true);
  });
});

describe("ChatRequestSchema", () => {
  it("accepts minimal request (just a message)", () => {
    expect(
      ChatRequestSchema.safeParse({ message: "Why are my leaves yellowing?" })
        .success,
    ).toBe(true);
  });

  it("rejects empty messages", () => {
    expect(ChatRequestSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("rejects messages over 10k chars", () => {
    expect(
      ChatRequestSchema.safeParse({ message: "x".repeat(10_001) }).success,
    ).toBe(false);
  });

  it("rejects non-uuid threadId / growId when provided", () => {
    expect(
      ChatRequestSchema.safeParse({
        message: "hi",
        threadId: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      ChatRequestSchema.safeParse({
        message: "hi",
        growId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("UploadFinalizeRequestSchema", () => {
  it("requires imageId and storagePath", () => {
    expect(
      UploadFinalizeRequestSchema.safeParse({
        imageId: UUID,
        storagePath: "plants/x.png",
      }).success,
    ).toBe(true);
    expect(
      UploadFinalizeRequestSchema.safeParse({ imageId: UUID }).success,
    ).toBe(false);
  });

  it("rejects idempotencyKey shorter than 8 chars", () => {
    expect(
      UploadFinalizeRequestSchema.safeParse({
        imageId: UUID,
        storagePath: "x",
        idempotencyKey: "short",
      }).success,
    ).toBe(false);
  });
});

describe("AnalyzeRequestSchema", () => {
  it("requires a uuid imageId", () => {
    expect(AnalyzeRequestSchema.safeParse({ imageId: UUID }).success).toBe(
      true,
    );
    expect(AnalyzeRequestSchema.safeParse({ imageId: "x" }).success).toBe(
      false,
    );
  });
});

describe("AnalysisJobStatusSchema", () => {
  it.each([
    "queued",
    "running",
    "succeeded",
    "failed",
    "retrying",
    "cancelled",
  ])("accepts %s", (status) => {
    expect(AnalysisJobStatusSchema.safeParse(status).success).toBe(true);
  });

  it("rejects unknown status", () => {
    expect(AnalysisJobStatusSchema.safeParse("pending").success).toBe(false);
  });
});

describe("ApiErrorSchema", () => {
  it("parses a wire-format error envelope", () => {
    const r = ApiErrorSchema.safeParse({
      error: {
        code: "UNAUTHORIZED",
        message: "Not signed in",
        requestId: "req_1",
      },
    });
    expect(r.success).toBe(true);
  });
});
