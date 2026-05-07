from __future__ import annotations

import base64
import json
import logging
from datetime import UTC, datetime

import httpx

from app.config import settings
from app.middleware import get_request_id, log_event
from app.models.analysis import (
    AnalysisFinding,
    AnalyzeRequest,
    AnalyzeResponse,
    FindingCategory,
    FindingSeverity,
)
from app.services.prompts import SYSTEM_PROMPT, build_analysis_prompt
from app.services.scoring import compute_health_score

MODEL_VERSION = "gpt-4o-mini-vision"
logger = logging.getLogger(__name__)


async def _fetch_storage_image(storage_path: str) -> tuple[bytes, str]:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase storage credentials are not configured")

    base_url = settings.supabase_url.rstrip("/")
    url = f"{base_url}/storage/v1/object/authenticated/plant-images/{storage_path}"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "x-request-id": get_request_id(),
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "image/jpeg")
        return response.content, content_type


def _build_fallback_response(
    request: AnalyzeRequest,
    *,
    reason: str,
) -> AnalyzeResponse:
    finding = AnalysisFinding(
        category=FindingCategory.general,
        severity=FindingSeverity.info,
        title="Fallback analysis only",
        description=(
            "PhenoSage could not verify the image with the primary model path. "
            "Treat this result as inconclusive until the image can be re-analyzed."
        ),
        recommendation=(
            "Retry analysis after confirming storage access and OpenAI availability. "
            "Do not treat this as a confident diagnosis."
        ),
    )

    return AnalyzeResponse(
        plant_id=request.plant_id,
        image_id=request.image_id,
        overall_health_score=0.0,
        summary=(
            "Inconclusive fallback result. The primary analysis path was unavailable, "
            "so no confident diagnosis was produced."
        ),
        findings=[finding],
        compared_to_image_id=request.previous_image_id,
        comparison_summary=None,
        analyzed_at=datetime.now(tz=UTC),
        model_version=MODEL_VERSION,
        analysis_mode="fallback",
        is_fallback=True,
        fallback_reason=reason,
        request_id=get_request_id(),
    )


def _parse_findings(raw_findings: object) -> list[AnalysisFinding]:
    if not isinstance(raw_findings, list):
        return []

    findings: list[AnalysisFinding] = []
    for item in raw_findings:
        if not isinstance(item, dict):
            continue
        try:
            findings.append(AnalysisFinding(**item))
        except Exception as exc:  # pragma: no cover - defensive parsing
            logger.warning("Skipping malformed finding: %s", exc)
    return findings


async def _run_model_analysis(
    request: AnalyzeRequest,
    *,
    image_bytes: bytes,
    content_type: str,
) -> AnalyzeResponse:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    from openai import AsyncOpenAI

    encoded = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{content_type};base64,{encoded}"
    client = AsyncOpenAI(api_key=settings.openai_api_key)

    completion = await client.chat.completions.create(
        model=MODEL_VERSION,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": build_analysis_prompt(request.grow_context)},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ],
    )

    raw_content = completion.choices[0].message.content or "{}"
    parsed = json.loads(raw_content)
    findings = _parse_findings(parsed.get("findings"))

    if not findings:
        findings = [
            AnalysisFinding(
                category=FindingCategory.general,
                severity=FindingSeverity.info,
                title="No issues confidently identified",
                description=(
                    "The model did not return structured findings. Treat the result as "
                    "low-confidence and review the image manually."
                ),
                recommendation="Retry with a clearer image if you need a stronger diagnosis.",
            )
        ]

    overall_health_score = parsed.get("overall_health_score")
    if not isinstance(overall_health_score, (float, int)):
        overall_health_score = compute_health_score(findings)

    summary = parsed.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        summary = "Image reviewed successfully, but the returned summary was incomplete."

    return AnalyzeResponse(
        plant_id=request.plant_id,
        image_id=request.image_id,
        overall_health_score=float(overall_health_score),
        summary=summary,
        findings=findings,
        compared_to_image_id=request.previous_image_id,
        comparison_summary=None,
        analyzed_at=datetime.now(tz=UTC),
        model_version=MODEL_VERSION,
        analysis_mode="model",
        is_fallback=False,
        fallback_reason=None,
        request_id=get_request_id(),
    )


async def run_analysis(request: AnalyzeRequest) -> AnalyzeResponse:
    try:
        image_bytes, content_type = await _fetch_storage_image(request.storage_path)
        response = await _run_model_analysis(
            request,
            image_bytes=image_bytes,
            content_type=content_type,
        )
        log_event(
            logging.INFO,
            "analysis completed",
            plant_id=request.plant_id,
            image_id=request.image_id,
            analysis_mode=response.analysis_mode,
            is_fallback=response.is_fallback,
        )
        return response
    except Exception as exc:
        reason = exc.__class__.__name__
        log_event(
            logging.WARNING,
            "analysis fallback triggered",
            plant_id=request.plant_id,
            image_id=request.image_id,
            fallback_reason=reason,
        )
        return _build_fallback_response(request, reason=reason)
