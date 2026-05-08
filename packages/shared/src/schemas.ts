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
