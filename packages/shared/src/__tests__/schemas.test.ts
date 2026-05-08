import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_MESSAGE_BYTES,
  MAX_IMAGE_BYTES,
  analyzeRequestSchema,
  chatRequestSchema,
  plantImageFinalizeRequestSchema,
  uploadsSignRequestSchema,
} from "../schemas";

describe("uploadsSignRequestSchema", () => {
  it("accepts a minimal valid body", () => {
    const result = uploadsSignRequestSchema.safeParse({
      plantId: "p1",
      fileName: "leaf.jpg",
      contentType: "image/jpeg",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when plantId is missing", () => {
    const result = uploadsSignRequestSchema.safeParse({
      fileName: "leaf.jpg",
      contentType: "image/jpeg",
    });
    expect(result.success).toBe(false);
  });

  it("rejects sizeBytes above the image cap", () => {
    const result = uploadsSignRequestSchema.safeParse({
      plantId: "p1",
      fileName: "leaf.jpg",
      contentType: "image/jpeg",
      sizeBytes: MAX_IMAGE_BYTES + 1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts sizeBytes at the cap", () => {
    const result = uploadsSignRequestSchema.safeParse({
      plantId: "p1",
      fileName: "leaf.jpg",
      contentType: "image/jpeg",
      sizeBytes: MAX_IMAGE_BYTES,
    });
    expect(result.success).toBe(true);
  });
});

describe("plantImageFinalizeRequestSchema", () => {
  it("requires imageId and storagePath", () => {
    expect(plantImageFinalizeRequestSchema.safeParse({}).success).toBe(false);
    expect(
      plantImageFinalizeRequestSchema.safeParse({ imageId: "i1" }).success,
    ).toBe(false);
    expect(
      plantImageFinalizeRequestSchema.safeParse({
        imageId: "i1",
        storagePath: "plants/p1/leaf.jpg",
      }).success,
    ).toBe(true);
  });
});

describe("analyzeRequestSchema", () => {
  it("treats an empty body as valid (all fields optional)", () => {
    expect(analyzeRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a known mode and rejects unknown ones", () => {
    expect(analyzeRequestSchema.safeParse({ mode: "fallback" }).success).toBe(
      true,
    );
    expect(analyzeRequestSchema.safeParse({ mode: "auto" }).success).toBe(
      false,
    );
  });
});

describe("chatRequestSchema", () => {
  it("requires a non-empty trimmed message", () => {
    expect(chatRequestSchema.safeParse({}).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: "" }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: "   " }).success).toBe(false);
    const ok = chatRequestSchema.safeParse({ message: "  hello  " });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.message).toBe("hello");
  });

  it("rejects messages above the chat byte cap", () => {
    const oversize = "x".repeat(MAX_CHAT_MESSAGE_BYTES + 1);
    expect(chatRequestSchema.safeParse({ message: oversize }).success).toBe(
      false,
    );
  });
});
