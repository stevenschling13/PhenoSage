"""
Image analysis pipeline service.

TODO (Milestone 1 → 2):
  - Fetch image bytes from Supabase Storage using the service role key
  - Encode to base64 for OpenAI Vision API
  - Build a structured prompt from GrowContext
  - Parse GPT-4o response into AnalysisFinding list
  - Return scored AnalyzeResponse
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.models.analysis import (
    AnalysisFinding,
    AnalyzeRequest,
    AnalyzeResponse,
    FindingCategory,
    FindingSeverity,
)

MODEL_VERSION = "gpt-4o-stub-0.1"


async def run_analysis(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    Entry point for the image analysis pipeline.

    Currently returns a stub response. Wire to OpenAI Vision in Milestone 1.
    """
    # TODO: Fetch image from Supabase Storage
    # TODO: Optionally fetch previous image for comparison
    # TODO: Build prompt with grow context
    # TODO: Call OpenAI Vision API
    # TODO: Parse structured findings from response
    # TODO: Score overall health 0–100

    stub_finding = AnalysisFinding(
        category=FindingCategory.general,
        severity=FindingSeverity.info,
        title="Analysis not yet implemented",
        description="This is a placeholder finding. Connect OpenAI Vision to enable real analysis.",
        recommendation="Complete Milestone 1 implementation.",
    )

    return AnalyzeResponse(
        plant_id=request.plant_id,
        image_id=request.image_id,
        overall_health_score=0.0,
        summary="Stub analysis — not yet implemented.",
        findings=[stub_finding],
        compared_to_image_id=request.previous_image_id,
        comparison_summary=None,
        analyzed_at=datetime.now(tz=UTC),
        model_version=MODEL_VERSION,
    )
