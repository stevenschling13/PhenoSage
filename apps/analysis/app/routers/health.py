from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from app.config import settings

router = APIRouter()


@router.get("/health")
async def health_check() -> JSONResponse:
    """Liveness probe — cheap, no I/O."""
    return JSONResponse(
        {
            "status": "ok",
            "service": "phenosage-analysis",
            "env": settings.app_env,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )


@router.get("/ready")
async def readiness_check() -> JSONResponse:
    """Readiness probe — verifies required config is present.

    Returns 503 if any required configuration is missing so the platform's
    load balancer can drain traffic from unhealthy instances.
    """
    checks: dict[str, bool] = {
        "openai_key": bool(settings.openai_api_key),
        "supabase_url": bool(settings.supabase_url),
        "supabase_service_key": bool(settings.supabase_service_role_key),
        "service_api_key": settings.analysis_service_api_key != "dev-api-key"
        or settings.app_env != "production",
    }

    details = {
        "status": "ok" if all(checks.values()) else "not_ready",
        "service": "phenosage-analysis",
        "env": settings.app_env,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
        "commit": os.environ.get("RAILWAY_GIT_COMMIT_SHA")
        or os.environ.get("GIT_COMMIT_SHA")
        or "unknown",
    }

    if not all(checks.values()):
        return JSONResponse(details, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    return JSONResponse(details)
