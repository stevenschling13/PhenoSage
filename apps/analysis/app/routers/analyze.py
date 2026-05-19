from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.errors import AnalysisError
from app.models.analysis import (
    AnalyzeRequest,
    AnalyzeResponse,
    CompareRequest,
    CompareResponse,
    PreflightRequest,
    PreflightResponse,
)
from app.services.image_analysis import run_analysis
from app.services.image_comparison import compare_images
from app.services.preflight import run_preflight

router = APIRouter()
bearer = HTTPBearer()


def verify_api_key(
    credentials: HTTPAuthorizationCredentials = Security(bearer),
) -> None:
    """Verify the shared secret from the Next.js proxy."""
    if credentials.credentials != settings.analysis_service_api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    summary="Analyze a plant image",
    description=(
        "Accepts image metadata and grow context from the Next.js proxy. "
        "Fetches the image from Supabase Storage, runs AI analysis, "
        "and returns structured findings. "
        "This endpoint must never be called directly by the browser."
    ),
)
async def analyze_plant(
    request: AnalyzeRequest,
    _: None = Depends(verify_api_key),
) -> AnalyzeResponse:
    return await run_analysis(request)


@router.post(
    "/compare",
    response_model=CompareResponse,
    summary='Compare two plant images and return a "what changed" payload',
    description=(
        "Accepts the storage paths for the two most recent images of a plant "
        "(current and previous) plus grow context, downloads both, and runs a "
        "single multimodal vision call describing how the plant changed. "
        "Called only by the Next.js proxy — never directly by the browser."
    ),
)
async def compare_plant_images(
    request: CompareRequest,
    _: None = Depends(verify_api_key),
) -> CompareResponse:
    return await compare_images(request)


@router.post(
    "/preflight",
    response_model=PreflightResponse,
    summary="Capture-quality preflight",
    description=(
        "Runs the same PIL-based quality checks as the pre-analysis gate "
        "but returns a structured ok/reason/hint payload instead of "
        "raising. Used by the Next.js upload flow to coach the user "
        "before a vision call is paid for. Bearer-auth only; never "
        "called directly by the browser."
    ),
)
async def preflight_plant_image(
    request: PreflightRequest,
    _: None = Depends(verify_api_key),
) -> PreflightResponse:
    try:
        return await run_preflight(request)
    except AnalysisError as exc:
        # Storage / config failures map to clean upstream errors with a
        # safe, non-leaky message — the web proxy turns these into 502/503
        # for the browser. Do NOT swallow into a synthetic "ok=true"
        # result; that would defeat the user-trust purpose of preflight.
        raise HTTPException(status_code=exc.status_code, detail=exc.code) from exc
