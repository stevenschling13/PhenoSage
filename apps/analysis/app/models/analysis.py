from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class FindingCategory(StrEnum):
    nutrient_deficiency = "nutrient_deficiency"
    nutrient_toxicity = "nutrient_toxicity"
    pest = "pest"
    disease = "disease"
    environmental = "environmental"
    training = "training"
    general = "general"
    positive = "positive"


class FindingSeverity(StrEnum):
    info = "info"
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class GrowContext(BaseModel):
    """Contextual grow data sent from the Next.js proxy."""

    grow_id: str
    strain: str | None = None
    stage: str | None = None
    medium: str | None = None
    light_type: str | None = None
    days_since_start: int | None = None
    notes: str | None = None


class AnalyzeRequest(BaseModel):
    """Request body for POST /analyze."""

    plant_id: str
    image_id: str
    # Supabase Storage path — the service fetches the image using the service role key
    storage_path: str
    grow_context: GrowContext
    # If provided, compare this image to the previous one
    previous_image_id: str | None = None
    previous_storage_path: str | None = None


class AnalysisFinding(BaseModel):
    category: FindingCategory
    severity: FindingSeverity
    title: str
    description: str
    recommendation: str | None = None


class AnalyzeResponse(BaseModel):
    """Response body for POST /analyze."""

    model_config = ConfigDict(protected_namespaces=())

    plant_id: str
    image_id: str
    overall_health_score: float = Field(ge=0, le=100)
    summary: str
    findings: list[AnalysisFinding]
    compared_to_image_id: str | None = None
    comparison_summary: str | None = None
    analyzed_at: datetime
    model_version: str
    analysis_mode: str = "fallback"
    is_fallback: bool = False
    fallback_reason: str | None = None
    request_id: str | None = None
