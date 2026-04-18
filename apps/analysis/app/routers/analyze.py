from fastapi import APIRouter, Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.models.analysis import AnalyzeRequest, AnalyzeResponse
from app.services.image_analysis import run_analysis

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
