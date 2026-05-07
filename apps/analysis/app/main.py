import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.middleware import CorrelationIdMiddleware
from app.routers.analyze import router as analyze_router
from app.routers.health import router as health_router
from app.services import storage
from app.telemetry import init_all as init_telemetry


def _configure_logging() -> None:
    level_name = (settings.log_level or "info").upper()
    level = getattr(logging, level_name, logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


_configure_logging()
init_telemetry()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Own a process-wide ``httpx.AsyncClient`` so fetches reuse connections."""
    client = httpx.AsyncClient(timeout=20.0)
    storage.set_client(client)
    try:
        yield
    finally:
        storage.set_client(None)
        await client.aclose()


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
    lifespan=lifespan,
)

# CORS: only the configured origins (the Vercel app URL in production).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "x-request-id"],
    expose_headers=["x-request-id"],
)

# Pure ASGI class; Starlette's stub expects a `_MiddlewareClass` protocol but
# accepts ASGI classes at runtime. Safe to ignore the arg-type mismatch.
app.add_middleware(CorrelationIdMiddleware)  # type: ignore[arg-type]

app.include_router(health_router, tags=["health"])
app.include_router(analyze_router, tags=["analysis"])
