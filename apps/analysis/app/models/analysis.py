from __future__ import annotations

import re
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Supabase Storage object paths are bucket-relative. Allow only safe
# characters and forbid anything that could escape the object key when
# interpolated into the storage URL (path traversal, absolute paths,
# URL schemes, query/fragment delimiters, whitespace, control chars).
# Each segment must be non-empty alphanumerics with `-`, `_`, or `.`.
_STORAGE_PATH_SEGMENT = r"[A-Za-z0-9][A-Za-z0-9._-]*"
_STORAGE_PATH_RE = re.compile(
    rf"^{_STORAGE_PATH_SEGMENT}(?:/{_STORAGE_PATH_SEGMENT})*$"
)
_STORAGE_PATH_MAX_LEN = 512


def _validate_storage_path(value: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("storage path must be a non-empty string")
    if len(value) > _STORAGE_PATH_MAX_LEN:
        raise ValueError("storage path is too long")
    if ".." in value.split("/"):
        raise ValueError("storage path must not contain '..' segments")
    if not _STORAGE_PATH_RE.fullmatch(value):
        raise ValueError(
            "storage path may only contain alphanumerics, '.', '_', '-', "
            "and '/' separators"
        )
    return value


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

    @field_validator("storage_path")
    @classmethod
    def _check_storage_path(cls, value: str) -> str:
        return _validate_storage_path(value)

    @field_validator("previous_storage_path")
    @classmethod
    def _check_previous_storage_path(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_storage_path(value)


class AnalysisFinding(BaseModel):
    category: FindingCategory
    severity: FindingSeverity
    confidence_score: float | None = Field(default=None, ge=0, le=1)
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


class CompareRequest(BaseModel):
    """Request body for POST /compare.

    The web proxy sends the two most recent images for a plant. The
    "current" image is the freshest capture; "previous" is the prior one.
    Order matters: the model is told to describe how the plant changed
    *from previous to current*.
    """

    plant_id: str
    image_id_current: str
    storage_path_current: str
    image_id_previous: str
    storage_path_previous: str
    grow_context: GrowContext

    @field_validator("storage_path_current")
    @classmethod
    def _check_current(cls, value: str) -> str:
        return _validate_storage_path(value)

    @field_validator("storage_path_previous")
    @classmethod
    def _check_previous(cls, value: str) -> str:
        return _validate_storage_path(value)


class UniformityDelta(StrEnum):
    """Coarse direction of canopy uniformity / overall health between the two
    images. Mirrors the ``trend`` vocabulary in the executive-summary spec
    so the UI can colour-code consistently with the health score."""

    improved = "improved"
    unchanged = "unchanged"
    declined = "declined"
    unknown = "unknown"


class CompareResponse(BaseModel):
    """Structured "what changed" between two plant images.

    The UI's "What Changed?" button renders ``summary`` as a one-liner and
    ``bullets`` as a list. ``uniformity_delta`` drives the colour token.
    """

    model_config = ConfigDict(protected_namespaces=())

    plant_id: str
    image_id_current: str
    image_id_previous: str
    summary: str
    bullets: list[str]
    uniformity_delta: UniformityDelta = UniformityDelta.unknown
    confidence: float = Field(default=0.0, ge=0, le=1)
    analyzed_at: datetime
    model_version: str
    analysis_mode: str = "fallback"
    is_fallback: bool = False
    fallback_reason: str | None = None
    request_id: str | None = None


class PreflightRequest(BaseModel):
    """Request body for POST /preflight.

    Carries the storage path of an already-uploaded image so the service
    can fetch it via the same service-role channel that ``/analyze`` uses.
    The image is never re-uploaded over the public Internet.
    """

    plant_id: str
    image_id: str
    storage_path: str

    @field_validator("storage_path")
    @classmethod
    def _check_storage_path(cls, value: str) -> str:
        return _validate_storage_path(value)


class PreflightResponse(BaseModel):
    """Structured outcome of the non-destructive capture-quality check.

    ``ok`` true means the image is fit to be sent to the vision model.
    ``reason`` mirrors :data:`app.errors.IMAGE_QUALITY_REASONS` when ``ok``
    is false; ``hint`` is a short, user-facing string the UI surfaces
    above the upload button.
    """

    plant_id: str
    image_id: str
    ok: bool
    reason: str | None = None
    hint: str
    request_id: str | None = None
