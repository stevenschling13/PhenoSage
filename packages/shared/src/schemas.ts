import { z } from "zod";

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

export const ApiSuccessSchema = z.object({
  requestId: z.string().optional(),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorSchema>;
export type AnalysisJobStatus = z.infer<typeof AnalysisJobStatusSchema>;
export type UploadSignRequest = z.infer<typeof UploadSignRequestSchema>;
export type UploadFinalizeRequest = z.infer<typeof UploadFinalizeRequestSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
