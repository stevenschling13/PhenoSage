from __future__ import annotations

import base64
import json
import logging
import re
from datetime import UTC, datetime
from urllib.parse import quote

import httpx

from app.config import settings
from app.errors import (
    AnalysisError,
    ConfigurationError,
    InvalidStoragePath,
    ModelBadResponse,
    ModelRateLimited,
    ModelUnavailable,
    StorageUnavailable,
)
from app.middleware import get_request_id, log_event
from app.models.analysis import (
    AnalysisFinding,
    AnalyzeRequest,
    AnalyzeResponse,
    FindingCategory,
    FindingSeverity,
)
from app.services.image_quality import assess_image_quality
from app.services.prompts import SYSTEM_PROMPT, build_analysis_prompt
from app.services.scoring import compute_health_score

MODEL_VERSION = "gpt-4o-mini-vision"
logger = logging.getLogger(__name__)
_STORAGE_PATH_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")


def _sanitize_storage_path(storage_path: str) -> str:
    path = storage_path.strip()
    if (
        not path
        or path.startswith("/")
        or path.startswith(".")
        or ".." in path
        or "\\" in path
        or "?" in path
        or "#" in path
        or not _STORAGE_PATH_PATTERN.fullmatch(path)
    ):
        raise InvalidStoragePath()
    return quote(path, safe="/-._~")


async def _fetch_storage_image(storage_path: str) -> tuple[bytes, str]:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        # Missing creds is a deploy-time misconfiguration, not a transient
        # failure — never retry.
        raise ConfigurationError("Supabase storage credentials are not configured")

    safe_storage_path = _sanitize_storage_path(storage_path)
    base_url = settings.supabase_url.rstrip("/")
    url = (
        f"{base_url}/storage/v1/object/authenticated/plant-images/"
        f"{safe_storage_path}"
    )
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "x-request-id": get_request_id(),
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "image/jpeg")
            return response.content, content_type
    except httpx.HTTPStatusError as exc:
        # 401/403 here means the service-role key is wrong / revoked — that's
        # a configuration problem, not a transient outage.
        if exc.response.status_code in (401, 403):
            raise ConfigurationError(
                "Supabase rejected the service-role credential."
            ) from exc
        raise StorageUnavailable(
            f"Supabase storage returned HTTP {exc.response.status_code}."
        ) from exc
    except (httpx.TimeoutException, httpx.TransportError, ConnectionError) as exc:
        raise StorageUnavailable(
            "Supabase storage is unreachable or timed out."
        ) from exc


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
        raise ConfigurationError("OPENAI_API_KEY is not configured")

    from openai import AsyncOpenAI

    encoded = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{content_type};base64,{encoded}"
    client = AsyncOpenAI(api_key=settings.openai_api_key)

    try:
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
    except Exception as exc:
        # Classify the underlying provider error without echoing the
        # provider response body. We probe by attribute / class-name so
        # the test suite doesn't need the real `openai` package installed.
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
            raise ModelUnavailable(f"Model upstream returned HTTP {status}.") from exc
        if cls_name in {"APIConnectionError", "ConnectionError"}:
            raise ModelUnavailable("Model upstream is unreachable.") from exc
        if isinstance(status, int) and status in (401, 403):
            raise ConfigurationError("Model rejected our credentials.") from exc
        # Anything else is unexpected — re-raise so it surfaces as a
        # programmer error and is NOT swallowed into a fake fallback
        # diagnosis.
        raise

    raw_content = completion.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw_content)
    except (ValueError, TypeError) as exc:
        raise ModelBadResponse("Model returned non-JSON content.") from exc

    if not isinstance(parsed, dict):
        raise ModelBadResponse("Model returned a non-object JSON payload.")

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
        # Pre-vision quality gate: refuse unanalysable images here so the
        # outcome is an explicit *inconclusive* envelope rather than a
        # low-confidence diagnosis from the vision model. ImageQuality-
        # Inconclusive is an AnalysisError subclass, so it's routed by the
        # except branch below into the same fallback path.
        assess_image_quality(image_bytes)
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
    except AnalysisError as exc:
        # Only EXPECTED dependency failures become an inconclusive fallback.
        # Programmer defects (TypeError, AttributeError, etc.) intentionally
        # propagate so they surface as a real error in monitoring instead of
        # being silently re-skinned as a "fallback diagnosis" — see the
        # plant-health output discipline rule in .github/copilot-instructions.md.
        log_event(
            logging.WARNING,
            "analysis fallback triggered",
            plant_id=request.plant_id,
            image_id=request.image_id,
            fallback_reason=exc.code,
        )
        return _build_fallback_response(request, reason=exc.code)
