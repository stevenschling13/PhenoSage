import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.errors import AnalysisError
from app.middleware import RequestContextMiddleware, get_request_id
from app.routers.analyze import router as analyze_router
from app.routers.health import router as health_router
from app.telemetry import init_all as init_telemetry

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
init_telemetry()

app = FastAPI(
    title="PhenoSage Analysis Service",
    description=(
        "Private AI analysis backend for PhenoSage. "
        "All requests must originate from the Next.js proxy (Vercel). "
        "The browser must never call this service directly."
    ),
    version="0.1.0",
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url=None,
)
app.add_middleware(RequestContextMiddleware)

# CORS: only the configured origins (the Vercel app URL in production).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health_router, tags=["health"])
app.include_router(analyze_router, tags=["analysis"])


@app.exception_handler(AnalysisError)
async def _analysis_error_handler(
    _request: Request, exc: AnalysisError
) -> JSONResponse:
    """Map typed analysis errors to a safe JSON envelope.

    Mirrors the web `apiError()` envelope so the Next.js proxy can map fields
    1-to-1. Critically, we surface `exc.default_message` (a stable, redacted
    string), never `str(exc)` — chained provider errors live on `__cause__`
    and stay in server-side logs only.
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.default_message,
                "request_id": get_request_id(),
            },
            "retryable": exc.retryable,
        },
    )
