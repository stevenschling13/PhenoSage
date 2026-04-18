from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.analyze import router as analyze_router
from app.routers.health import router as health_router
from app.telemetry import init_all as init_telemetry

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
