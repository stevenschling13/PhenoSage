// Grow
export type GrowStage =
  | "germination"
  | "seedling"
  | "vegetative"
  | "pre_flower"
  | "flower"
  | "late_flower"
  | "harvest"
  | "dry_cure";

export type GrowMedium =
  | "soil"
  | "coco"
  | "hydro"
  | "aero"
  | "living_soil"
  | "other";

export type LightType =
  | "hps"
  | "cmh"
  | "led"
  | "t5"
  | "sun"
  | "mixed"
  | "other";

export interface Grow {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  stage: GrowStage;
  medium: GrowMedium;
  lightType: LightType;
  targetHarvestDate?: string; // ISO date
  startDate: string; // ISO date
  isArchived: boolean;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// GrowMember
export type GrowRole = "owner" | "collaborator" | "viewer";

export interface GrowMember {
  growId: string;
  userId: string;
  role: GrowRole;
  createdAt: string;
}

// Plant
export interface Plant {
  id: string;
  growId: string;
  name: string;
  strain?: string;
  batchLabel?: string;
  notes?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

// PlantImage
export type ImageSource = "upload" | "camera";

export interface PlantImage {
  id: string;
  plantId: string;
  growId: string;
  userId: string;
  storagePath: string; // Supabase Storage path (private)
  signedUrl?: string; // ephemeral, not stored
  takenAt?: string; // ISO timestamp
  source: ImageSource;
  notes?: string;
  createdAt: string;
}

// PlantObservation
export interface PlantObservation {
  id: string;
  plantId: string;
  growId: string;
  userId: string;
  observedAt: string; // ISO timestamp
  heightCm?: number;
  notes?: string;
  createdAt: string;
}

// PlantFinding
export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";
export type FindingCategory =
  | "nutrient_deficiency"
  | "nutrient_toxicity"
  | "pest"
  | "disease"
  | "environmental"
  | "training"
  | "general"
  | "positive";

// Mirrors the `source` text+check column added in migration 010_user_findings.
// 'ai' = analysis service write (service role); 'user_reported' = user-side
// insert via the chat `record_image_finding` tool or future manual flows.
export type FindingSource = "ai" | "user_reported";

export interface PlantFinding {
  id: string;
  plantId: string;
  growId: string;
  imageId?: string;
  category: FindingCategory;
  severity: FindingSeverity;
  confidenceScore?: number;
  title: string;
  description: string;
  recommendation?: string;
  source: FindingSource;
  resolvedAt?: string;
  createdAt: string;
}

// ChatThread
export interface ChatThread {
  id: string;
  userId: string;
  growId?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

// ChatMessage
export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// AnalysisResponse — returned by the analysis service through the Next.js proxy
export interface AnalysisFinding {
  category: FindingCategory;
  severity: FindingSeverity;
  confidenceScore?: number;
  title: string;
  description: string;
  recommendation?: string;
}

export interface AnalysisResponse {
  plantId: string;
  imageId: string;
  overallHealthScore: number; // 0–100
  summary: string;
  findings: AnalysisFinding[];
  comparedToImageId?: string;
  comparisonSummary?: string;
  analyzedAt: string; // ISO timestamp
  modelVersion: string;
  analysisMode?: "fallback" | "model";
  isFallback?: boolean;
  fallbackReason?: string;
  requestId?: string;
}

export interface PlantAnalysis extends AnalysisResponse {
  id: string;
  growId: string;
  createdAt: string;
}

// Image comparison — returned by the analysis service's `/compare`
// endpoint through the Next.js proxy. Powers the "What Changed?" panel on
// the plant detail page. Wire field names mirror the pydantic model
// (snake_case → camelCase happens in the proxy normaliser).
export type UniformityDelta = "improved" | "unchanged" | "declined" | "unknown";

export interface ImageComparisonResult {
  plantId: string;
  imageIdCurrent: string;
  imageIdPrevious: string;
  summary: string;
  bullets: string[];
  uniformityDelta: UniformityDelta;
  confidence: number; // 0–1
  analyzedAt: string; // ISO timestamp
  modelVersion: string;
  analysisMode?: "fallback" | "model";
  isFallback?: boolean;
  fallbackReason?: string;
  requestId?: string;
}

// Capture coach (`AI Capture Coach` from the executive-summary PDFs).
// Mirrors `app.errors.IMAGE_QUALITY_REASONS` on the analysis side — keep
// the two in sync or the UI will fall back to a generic message.
export type PreflightReason =
  | "image_decode_failed"
  | "image_too_large"
  | "image_too_small"
  | "too_dark"
  | "too_bright"
  | "too_blurry";

export interface ImagePreflightResult {
  plantId: string;
  imageId: string;
  ok: boolean;
  reason: PreflightReason | null;
  hint: string;
  requestId?: string;
}

// GrowEvent
export type EventType =
  | "water"
  | "feed"
  | "top"
  | "fim"
  | "lst"
  | "defoliate"
  | "transplant"
  | "ipm"
  | "harvest"
  | "observation"
  | "note"
  | "other";

export interface GrowEvent {
  id: string;
  growId: string;
  plantId?: string;
  userId: string;
  eventType: EventType;
  notes?: string;
  occurredAt: string; // ISO timestamp
  createdAt: string;
}

// GrowTask — mirrors migration 008_grow_tasks.
// Tasks may be auto-spawned by the AFTER INSERT trigger on plant_findings
// (high/critical severity → urgent/high priority task), or created manually
// by the chat `create_grow_task` tool / future user-facing forms.
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "open" | "in_progress" | "done" | "dismissed";

export interface GrowTask {
  id: string;
  growId: string;
  plantId?: string;
  // 1:1 link to the plant_findings row that spawned this task. NULL when
  // the task was created manually.
  findingId?: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt?: string; // ISO timestamp
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
