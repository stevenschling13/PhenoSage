from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.models.analysis import (
    AnalyzeRequest,
    AnalyzeResponse,
    CompareRequest,
    CompareResponse,
)
from app.services.image_analysis import run_analysis
from app.services.image_comparison import compare_images

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
