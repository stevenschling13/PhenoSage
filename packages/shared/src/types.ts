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

export interface PlantFinding {
  id: string;
  plantId: string;
  growId: string;
  imageId?: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  recommendation?: string;
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
