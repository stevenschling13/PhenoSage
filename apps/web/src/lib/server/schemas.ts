import "server-only";
import { z } from "zod";

// Runtime validation schemas. Mirror the plain TS contract types exported
// from `@phenosage/shared` (which is type-only — no runtime deps allowed
// per `.github/instructions/packages-shared.instructions.md`).
//
// Drift between these schemas and the shared TS types is caught by the
// integration tests in PR B (where route handlers consume both sides) and
// by the per-schema unit tests in `__tests__/schemas.test.ts`.

export const UuidSchema = z.string().uuid();

export const UploadSignRequestSchema = z.object({
  plantId: UuidSchema,
  fileName: z.string().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic"]),
  takenAt: z.string().datetime().optional(),
  source: z.enum(["camera", "upload"]).optional(),
  notes: z.string().max(2_000).optional(),
});

export const ChatRequestSchema = z.object({
  threadId: UuidSchema.optional(),
  growId: UuidSchema.optional(),
  message: z.string().min(1).max(10_000),
});

export const UploadFinalizeRequestSchema = z.object({
  imageId: UuidSchema,
  storagePath: z.string().min(1).max(1_024),
  idempotencyKey: z.string().min(8).max(128).optional(),
  takenAt: z.string().datetime().optional(),
  source: z.enum(["camera", "upload"]).optional(),
  notes: z.string().max(2_000).optional(),
});

export const AnalyzeRequestSchema = z.object({
  imageId: UuidSchema,
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const AnalysisJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "retrying",
  "cancelled",
]);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
