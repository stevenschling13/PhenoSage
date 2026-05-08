from __future__ import annotations

import base64
import json
import logging
from datetime import UTC, datetime

from fastapi import HTTPException
from openai import APIConnectionError, APIStatusError, APITimeoutError
from tenacity import (
    AsyncRetrying,
    RetryCallState,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.config import settings
from app.middleware import get_request_id, log_event
from app.models.analysis import (
    AnalysisFinding,
    AnalyzeRequest,
    AnalyzeResponse,
    FindingCategory,
    FindingSeverity,
)
from app.services import image_comparison
from app.services.openai_client import get_openai_client
from app.services.prompts import SYSTEM_PROMPT, build_analysis_prompt
from app.services.scoring import compute_health_score
from app.services.storage import fetch_storage_image

MODEL_VERSION = "gpt-4o-mini-vision"
ALLOWED_IMAGE_MIME = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/heic"}
)
logger = logging.getLogger(__name__)


# ── Validation ───────────────────────────────────────────────────────────


def _normalize_mime(content_type: str) -> str:
    return content_type.split(";")[0].strip().lower()


def _validate_image(content_type: str, image_bytes: bytes) -> None:
    """Raise HTTPException(415) for unsupported MIME, 413 for oversize."""
    mime = _normalize_mime(content_type)
    if mime not in ALLOWED_IMAGE_MIME:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image MIME type: {mime}",
        )
    if len(image_bytes) > settings.image_max_bytes:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Image is {len(image_bytes)} bytes; "
                f"max is {settings.image_max_bytes}"
            ),
        )


# ── Retry policy ─────────────────────────────────────────────────────────


def _is_retryable_openai_error(exc: BaseException) -> bool:
    if isinstance(exc, (APIConnectionError, APITimeoutError)):
        return True
    if isinstance(exc, APIStatusError):
        # Retry on 5xx and 429 (rate-limit). 4xx (other) is the caller's
        # bug and should not be retried.
        return exc.status_code >= 500 or exc.status_code == 429
    return False


def _log_retry(retry_state: RetryCallState) -> None:
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    next_sleep = (
        retry_state.next_action.sleep if retry_state.next_action else None
    )
    log_event(
        logging.WARNING,
        "openai retry",
        attempt=retry_state.attempt_number,
        next_sleep_seconds=next_sleep,
        error_type=type(exc).__name__ if exc else None,
        error=str(exc) if exc else None,
    )


def _make_retrying() -> AsyncRetrying:
    return AsyncRetrying(
        stop=stop_after_attempt(settings.openai_max_retries + 1),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception(_is_retryable_openai_error),
        before_sleep=_log_retry,
        reraise=True,
    )


# ── Fallback ─────────────────────────────────────────────────────────────


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


# ── Parsing ──────────────────────────────────────────────────────────────


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


# ── Core analysis ────────────────────────────────────────────────────────


async def _run_model_analysis(
    request: AnalyzeRequest,
    *,
    image_bytes: bytes,
    content_type: str,
) -> AnalyzeResponse:
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{_normalize_mime(content_type)};base64,{encoded}"
    client = get_openai_client()

    async def _call() -> object:
        return await client.chat.completions.create(
            model=MODEL_VERSION,
            response_format={"type": "json_object"},
            max_tokens=1500,
            metadata={
                "plant_id": request.plant_id,
                "image_id": request.image_id,
                "request_id": get_request_id(),
            },
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": build_analysis_prompt(request.grow_context),
                        },
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
        )

    completion = None
    async for attempt in _make_retrying():
        with attempt:
            completion = await _call()
    # `reraise=True` guarantees `completion` is bound on success.
    assert completion is not None  # noqa: S101 - tenacity post-condition

    raw_content = completion.choices[0].message.content or "{}"  # type: ignore[attr-defined]
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
    """
    Top-level entry. Fetches the image, validates it, runs the model
    (with retries), and optionally appends a comparison summary.

    Failures fall into two buckets:
      - Client-fixable (HTTPException 413/415): re-raised so FastAPI
        returns the proper 4xx. Never converted to a fallback.
      - Everything else (storage, OpenAI 5xx after retries, parsing):
        swallowed and converted to an inconclusive fallback response,
        per the plant-health output discipline rule.
    """
    try:
        image_bytes, content_type = await fetch_storage_image(request.storage_path)
        _validate_image(content_type, image_bytes)
        response = await _run_model_analysis(
            request,
            image_bytes=image_bytes,
            content_type=content_type,
        )

        if request.previous_image_id and request.previous_storage_path:
            try:
                comparison = await image_comparison.compare_images(
                    image_id_a=request.previous_image_id,
                    storage_path_a=request.previous_storage_path,
                    image_id_b=request.image_id,
                    storage_path_b=request.storage_path,
                    grow_context=request.grow_context,
                )
                response = response.model_copy(
                    update={"comparison_summary": comparison}
                )
            except Exception as exc:
                # Comparison is supplementary — never let it sink the analysis.
                log_event(
                    logging.WARNING,
                    "image comparison failed; analysis proceeds without it",
                    plant_id=request.plant_id,
                    image_id=request.image_id,
                    error_type=exc.__class__.__name__,
                    error=str(exc),
                )

        log_event(
            logging.INFO,
            "analysis completed",
            plant_id=request.plant_id,
            image_id=request.image_id,
            analysis_mode=response.analysis_mode,
            is_fallback=response.is_fallback,
            has_comparison=response.comparison_summary is not None,
        )
        return response
    except HTTPException:
        # 413/415 from _validate_image — let FastAPI return the 4xx.
        raise
    except Exception as exc:
        reason = exc.__class__.__name__
        log_event(
            logging.WARNING,
            "analysis fallback triggered",
            plant_id=request.plant_id,
            image_id=request.image_id,
            fallback_reason=reason,
            error=str(exc),
        )
        return _build_fallback_response(request, reason=reason)
