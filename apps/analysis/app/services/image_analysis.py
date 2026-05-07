"""Image analysis pipeline — OpenAI Vision + structured output + health scoring."""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import Any

from app.models.analysis import (
    AnalysisFinding,
    AnalyzeRequest,
    AnalyzeResponse,
    FindingCategory,
    FindingSeverity,
)
from app.services.openai_client import AnalysisError, get_openai_client
from app.services.prompts import SYSTEM_PROMPT, build_analysis_prompt
from app.services.scoring import compute_health_score
from app.services.storage import (
    StorageFetchError,
    fetch_image_bytes,
    guess_content_type,
    image_to_data_url,
)

logger = logging.getLogger(__name__)

MODEL_NAME = "gpt-4o"
MODEL_VERSION = "gpt-4o-2024-08-06"
FALLBACK_MODEL_VERSION = "phenosage-fallback-0.1"

__all__ = ["AnalysisError", "get_openai_client", "run_analysis"]

_JSON_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


async def run_analysis(request: AnalyzeRequest) -> AnalyzeResponse:
    """Fetch the image, call OpenAI Vision, parse and score, and return a response."""
    try:
        image_bytes = await fetch_image_bytes(request.storage_path)
    except StorageFetchError as exc:
        logger.warning("image fetch failed: %s", exc)
        return _fallback_response(
            request,
            summary="Could not fetch the uploaded image for analysis.",
            reason=str(exc),
        )

    content_type = guess_content_type(request.storage_path)
    data_url = image_to_data_url(image_bytes, content_type)

    user_prompt = build_analysis_prompt(request.grow_context)

    try:
        parsed = await _call_vision(data_url, user_prompt)
    except AnalysisError as exc:
        logger.warning("vision call failed: %s", exc)
        return _fallback_response(
            request,
            summary="Automated analysis could not run; try again shortly.",
            reason=str(exc),
        )

    findings = _parse_findings(parsed)
    summary = str(parsed.get("summary", "")).strip() or "Analysis complete."
    model_score = parsed.get("overall_health_score")
    computed = compute_health_score(findings)
    score = _blend_scores(model_score, computed)

    comparison_summary: str | None = None
    if request.previous_image_id and request.previous_storage_path:
        # Lazy import: image_comparison depends on helpers from this module in
        # older revisions; importing at call time keeps the module graph acyclic.
        from app.services.image_comparison import compare_images

        try:
            text = await compare_images(
                request.image_id,
                request.storage_path,
                request.previous_image_id,
                request.previous_storage_path,
            )
            comparison_summary = text or None
        except Exception as exc:  # noqa: BLE001 - comparison is best-effort
            logger.info("image comparison skipped: %s", exc)
            comparison_summary = None

    return AnalyzeResponse(
        plant_id=request.plant_id,
        image_id=request.image_id,
        overall_health_score=score,
        summary=summary,
        findings=findings,
        compared_to_image_id=request.previous_image_id,
        comparison_summary=comparison_summary,
        analyzed_at=datetime.now(tz=UTC),
        model_version=MODEL_VERSION,
    )


async def _call_vision(data_url: str, user_prompt: str) -> dict[str, Any]:
    client = get_openai_client()
    try:
        response = await client.chat.completions.create(
            model=MODEL_NAME,
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=1200,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url, "detail": "high"},
                        },
                    ],
                },
            ],
        )
    except Exception as exc:  # noqa: BLE001 - translate to a domain error
        raise AnalysisError(f"OpenAI request failed: {exc}") from exc

    choice = response.choices[0] if response.choices else None
    content = choice.message.content if choice and choice.message else None
    if not content:
        raise AnalysisError("OpenAI returned an empty response")

    # Defensive: some models still wrap JSON in ```json fences even when the
    # response_format is set to json_object. Strip them before parsing.
    stripped = content.strip()
    fence_match = _JSON_FENCE_RE.match(stripped)
    if fence_match:
        stripped = fence_match.group(1).strip()

    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise AnalysisError(f"OpenAI response was not valid JSON: {exc}") from exc

    if not isinstance(parsed, dict):
        raise AnalysisError("OpenAI response was not a JSON object")
    return parsed


def _parse_findings(parsed: dict[str, Any]) -> list[AnalysisFinding]:
    raw_findings = parsed.get("findings")
    if not isinstance(raw_findings, list):
        return [_fallback_finding()]
    findings: list[AnalysisFinding] = []
    for item in raw_findings:
        if not isinstance(item, dict):
            continue
        category = _coerce_category(item.get("category"))
        severity = _coerce_severity(item.get("severity"))
        title = _safe_str(item.get("title"), max_len=120) or "Unlabeled finding"
        description = _safe_str(item.get("description"), max_len=2000)
        if not description:
            continue
        recommendation = _safe_str(item.get("recommendation"), max_len=2000)
        findings.append(
            AnalysisFinding(
                category=category,
                severity=severity,
                title=title,
                description=description,
                recommendation=recommendation or None,
            )
        )
    return findings or [_fallback_finding()]


def _coerce_category(value: Any) -> FindingCategory:
    if isinstance(value, str):
        try:
            return FindingCategory(value)
        except ValueError:
            pass
    return FindingCategory.general


def _coerce_severity(value: Any) -> FindingSeverity:
    if isinstance(value, str):
        try:
            return FindingSeverity(value)
        except ValueError:
            pass
    return FindingSeverity.info


def _safe_str(value: Any, max_len: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_len]


def _blend_scores(model_score: Any, computed: float) -> float:
    """Prefer the model's self-reported score if it's a number in range, else use
    the penalty-derived score."""
    if isinstance(model_score, int | float) and 0 <= float(model_score) <= 100:
        return round((float(model_score) + computed) / 2.0, 1)
    return computed


def _fallback_finding() -> AnalysisFinding:
    return AnalysisFinding(
        category=FindingCategory.general,
        severity=FindingSeverity.info,
        title="Inconclusive analysis",
        description=(
            "The analyzer could not produce a confident reading on this image. "
            "Try a well-lit photo of the whole plant with fan leaves visible."
        ),
        recommendation=(
            "Retake the photo in natural light with the plant centered in frame."
        ),
    )


def _fallback_response(
    request: AnalyzeRequest, *, summary: str, reason: str
) -> AnalyzeResponse:
    findings = [_fallback_finding()]
    return AnalyzeResponse(
        plant_id=request.plant_id,
        image_id=request.image_id,
        overall_health_score=compute_health_score(findings),
        summary=summary,
        findings=findings,
        compared_to_image_id=request.previous_image_id,
        comparison_summary=None,
        analyzed_at=datetime.now(tz=UTC),
        model_version=FALLBACK_MODEL_VERSION,
    )
