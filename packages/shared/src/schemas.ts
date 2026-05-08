import { z } from "zod";

/**
 * Cross-boundary request schemas.
 *
 * These are the source of truth for every JSON body the browser sends to a
 * Next.js Route Handler. Both runtime validation (`safeParse`) and TS types
 * are derived here so a single edit ripples to every consumer.
 *
 * Path params (`plantId`) and auth headers are validated by the route
 * handler itself, not by these schemas.
 */

// ── Primitives ────────────────────────────────────────────────────────────

/**
 * Domain identifiers (plants, images, threads, grows). Permissive on shape
 * (callers fixture short slugs in tests, real production uses UUIDs) but
 * always present and bounded.
 */
export const idSchema = z.string().min(1).max(128);

export const isoTimestampSchema = z
  .string()
  .min(1)
  .max(64)
  // Accept "2026-04-01T00:00:00Z" and offset-bearing forms.
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: "must be an ISO-8601 timestamp",
  });

export const imageSourceSchema = z.enum(["upload", "camera"]);

/** Whitelist of MIME types accepted by the upload pipeline. */
export const allowedImageMimeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

// ── Limits ────────────────────────────────────────────────────────────────

/** 15 MB cap on uploaded images (matches analysis-service cap). */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** 4 KB cap on a single chat message. */
export const MAX_CHAT_MESSAGE_BYTES = 4 * 1024;

/** 1 MB cap on JSON request bodies overall. */
export const MAX_JSON_REQUEST_BYTES = 1 * 1024 * 1024;

// ── Request payloads ──────────────────────────────────────────────────────

/** POST /api/uploads/sign */
export const uploadsSignRequestSchema = z.object({
  plantId: idSchema,
  fileName: z.string().min(1).max(255),
  // Strict whitelist enforced at the handler so we can return 415 distinctly
  // from a 400 (bad shape).
  contentType: z.string().min(1).max(64),
  sizeBytes: z.number().int().nonnegative().max(MAX_IMAGE_BYTES).optional(),
  takenAt: isoTimestampSchema.optional(),
  source: imageSourceSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type UploadsSignRequest = z.infer<typeof uploadsSignRequestSchema>;

/** POST /api/plants/[plantId]/images — finalize an upload row */
export const plantImageFinalizeRequestSchema = z.object({
  imageId: idSchema,
  storagePath: z.string().min(1).max(512),
  takenAt: isoTimestampSchema.optional(),
  source: imageSourceSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type PlantImageFinalizeRequest = z.infer<
  typeof plantImageFinalizeRequestSchema
>;

/** POST /api/plants/[plantId]/analyze */
export const analyzeRequestSchema = z.object({
  imageId: idSchema.optional(),
  mode: z.enum(["fallback", "model"]).optional(),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

/** POST /api/chat */
export const chatRequestSchema = z.object({
  threadId: idSchema.optional(),
  growId: idSchema.optional(),
  message: z
    .string()
    .min(1)
    .max(MAX_CHAT_MESSAGE_BYTES)
    .transform((v) => v.trim())
    .refine((v) => v.length > 0, { message: "message is required" }),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;
