"""Two-image "what changed?" comparison.

The Next.js proxy calls ``POST /compare`` with the two most recent
``plant_images`` for a plant. We download both, send them in a single
multimodal vision call, and return a structured ``CompareResponse`` whose
bullets become the UI's "What changed?" list.

Failure model mirrors ``image_analysis.run_analysis``: only expected
dependency failures (``AnalysisError`` subclasses) degrade to an
inconclusive envelope. Programmer defects propagate so they surface in
monitoring rather than masquerading as a low-confidence diagnosis.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import UTC, datetime

from app.config import settings
from app.errors import (
    AnalysisError,
    ConfigurationError,
    ModelBadResponse,
    ModelRateLimited,
    ModelUnavailable,
)
from app.middleware import get_request_id, log_event
from app.models.analysis import CompareRequest, CompareResponse, UniformityDelta
from app.services.image_quality import assess_image_quality
from app.services.prompts import (
    COMPARISON_SYSTEM_PROMPT,
    build_comparison_prompt,
)
from app.services.retry import with_retry
from app.services.storage import fetch_image

logger = logging.getLogger(__name__)

MODEL_VERSION = "gpt-4o-mini-vision"
_STORAGE_FETCH_MAX_ATTEMPTS = 3
_MODEL_CALL_MAX_ATTEMPTS = 2
_MAX_BULLETS = 5


def _build_fallback_response(
    request: CompareRequest,
    *,
    reason: str,
) -> CompareResponse:
    return CompareResponse(
        plant_id=request.plant_id,
        image_id_current=request.image_id_current,
        image_id_previous=request.image_id_previous,
        summary=(
            "Inconclusive comparison. The primary path was unavailable, so no "
            "confident description of change was produced."
        ),
        bullets=[
            "Comparison could not be completed — retry after confirming "
            "storage access and model availability.",
        ],
        uniformity_delta=UniformityDelta.unknown,
        confidence=0.0,
        analyzed_at=datetime.now(tz=UTC),
        model_version=MODEL_VERSION,
        analysis_mode="fallback",
        is_fallback=True,
        fallback_reason=reason,
        request_id=get_request_id(),
    )


def _coerce_uniformity(value: object) -> UniformityDelta:
    if isinstance(value, str):
        try:
            return UniformityDelta(value)
        except ValueError:
            return UniformityDelta.unknown
    return UniformityDelta.unknown


def _coerce_bullets(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, str):
            trimmed = item.strip()
            if trimmed:
                out.append(trimmed)
        if len(out) >= _MAX_BULLETS:
            break
    return out


async def _call_vision_model(
    request: CompareRequest,
    *,
    current_bytes: bytes,
    current_content_type: str,
    previous_bytes: bytes,
    previous_content_type: str,
) -> CompareResponse:
    if not settings.openai_api_key:
        raise ConfigurationError("OPENAI_API_KEY is not configured")

    from openai import AsyncOpenAI

    previous_data_url = (
        f"data:{previous_content_type};base64,"
        f"{base64.b64encode(previous_bytes).decode('utf-8')}"
    )
    current_data_url = (
        f"data:{current_content_type};base64,"
        f"{base64.b64encode(current_bytes).decode('utf-8')}"
    )

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    try:
        completion = await client.chat.completions.create(
            model=MODEL_VERSION,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": COMPARISON_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": build_comparison_prompt(request.grow_context),
                        },
                        {"type": "image_url", "image_url": {"url": previous_data_url}},
                        {"type": "image_url", "image_url": {"url": current_data_url}},
                    ],
                },
            ],
        )
    except Exception as exc:
        cls_name = exc.__class__.__name__
        status = getattr(exc, "status_code", None) or getattr(
            getattr(exc, "response", None), "status_code", None
        )
        if cls_name in {"APITimeoutError", "TimeoutError"} or isinstance(
            exc, TimeoutError
        ):
            raise ModelUnavailable("Model call timed out.") from exc
        if status == 429 or cls_name == "RateLimitError":
            raise ModelRateLimited("Model rate limited.") from exc
        if isinstance(status, int) and status >= 500:
            raise ModelUnavailable(
                f"Model upstream returned HTTP {status}."
            ) from exc
        if cls_name in {"APIConnectionError", "ConnectionError"}:
            raise ModelUnavailable("Model upstream is unreachable.") from exc
        if isinstance(status, int) and status in (401, 403):
            raise ConfigurationError("Model rejected our credentials.") from exc
        raise

    raw_content = completion.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw_content)
    except (ValueError, TypeError) as exc:
        raise ModelBadResponse("Model returned non-JSON content.") from exc
    if not isinstance(parsed, dict):
        raise ModelBadResponse("Model returned a non-object JSON payload.")

    bullets = _coerce_bullets(parsed.get("bullets"))
    if not bullets:
        # Treat an empty bullet list as a soft signal rather than a hard
        # error — surface a single low-confidence note so the UI never
        # renders a "0 changes" empty state silently.
        bullets = ["No visible change detected."]

    summary = parsed.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        summary = "Comparison completed but the summary was incomplete."

    confidence_raw = parsed.get("confidence")
    confidence = (
        float(confidence_raw)
        if isinstance(confidence_raw, (int, float))
        else 0.0
    )
    confidence = max(0.0, min(1.0, confidence))

    return CompareResponse(
        plant_id=request.plant_id,
        image_id_current=request.image_id_current,
        image_id_previous=request.image_id_previous,
        summary=summary.strip(),
        bullets=bullets,
        uniformity_delta=_coerce_uniformity(parsed.get("uniformity_delta")),
        confidence=confidence,
        analyzed_at=datetime.now(tz=UTC),
        model_version=MODEL_VERSION,
        analysis_mode="model",
        is_fallback=False,
        fallback_reason=None,
        request_id=get_request_id(),
    )


async def compare_images(request: CompareRequest) -> CompareResponse:
    """Compare two plant images and return a structured "what changed" payload.

    Both images are pre-gated by ``assess_image_quality`` so an unanalysable
    capture surfaces as an explicit inconclusive envelope rather than a
    low-confidence vision diagnosis. Only one bad image is needed to fall
    back.
    """
    try:
        current_bytes, current_content_type = await with_retry(
            lambda: fetch_image(request.storage_path_current),
            operation="storage.fetch.current",
            max_attempts=_STORAGE_FETCH_MAX_ATTEMPTS,
        )
        previous_bytes, previous_content_type = await with_retry(
            lambda: fetch_image(request.storage_path_previous),
            operation="storage.fetch.previous",
            max_attempts=_STORAGE_FETCH_MAX_ATTEMPTS,
        )
        assess_image_quality(current_bytes)
        assess_image_quality(previous_bytes)
        response = await with_retry(
            lambda: _call_vision_model(
                request,
                current_bytes=current_bytes,
                current_content_type=current_content_type,
                previous_bytes=previous_bytes,
                previous_content_type=previous_content_type,
            ),
            operation="model.compare",
            max_attempts=_MODEL_CALL_MAX_ATTEMPTS,
        )
        log_event(
            logging.INFO,
            "comparison completed",
            plant_id=request.plant_id,
            image_id_current=request.image_id_current,
            image_id_previous=request.image_id_previous,
            analysis_mode=response.analysis_mode,
            is_fallback=response.is_fallback,
        )
        return response
    except AnalysisError as exc:
        log_kwargs: dict[str, object] = {
            "plant_id": request.plant_id,
            "image_id_current": request.image_id_current,
            "image_id_previous": request.image_id_previous,
            "fallback_reason": exc.code,
        }
        if hasattr(exc, "reason"):
            log_kwargs["image_quality_reason"] = exc.reason
        log_event(logging.WARNING, "comparison fallback triggered", **log_kwargs)
        return _build_fallback_response(request, reason=exc.code)
