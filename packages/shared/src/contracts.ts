// Wire-level contract types shared across web (and, when relevant, the
// analysis service's pydantic models). Pure type aliases — no runtime
// dependencies, no I/O, no zod. The matching zod schemas live in
// `apps/web/src/lib/server/schemas.ts` and assert structural symmetry
// with these types at module load via a TypeScript identity check
// (see `verifyContractSymmetry` in that file).
//
// Field naming: camelCase on the TS side; the Supabase rows use
// snake_case and are mapped at the boundary (see `apps/web/src/lib/server/db.ts`).

import type { ImageSource } from "./types";

export type AnalysisJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "cancelled";

export type ImageContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic";

export interface UploadSignRequest {
  plantId: string;
  fileName: string;
  contentType: ImageContentType;
  takenAt?: string;
  source?: ImageSource;
  notes?: string;
}

export interface UploadFinalizeRequest {
  imageId: string;
  storagePath: string;
  idempotencyKey?: string;
  takenAt?: string;
  source?: ImageSource;
  notes?: string;
}

export interface AnalyzeRequest {
  imageId: string;
  idempotencyKey?: string;
}

export interface ChatRequest {
  threadId?: string;
  growId?: string;
  message: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

export interface ApiSuccessResponse {
  requestId?: string;
}
