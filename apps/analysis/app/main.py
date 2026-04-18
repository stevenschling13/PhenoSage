from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.analyze import router as analyze_router
from app.routers.health import router as health_router

app = FastAPI(
    title="PhenoSage Analysis Service",
    description=(
        "Private AI analysis backend for PhenoSage. "
        "All requests must originate from the Next.js proxy (Vercel). "
        "The browser must never call this service directly."
    ),
    version="0.1.0",
    # Disable the default docs in production — internal service
    docs_url="/docs" if True else None,
    redoc_url=None,
)

# CORS: Only allow requests from the Next.js proxy.
# In production, set ALLOWED_ORIGINS to your Vercel domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(health_router, tags=["health"])
app.include_router(analyze_router, tags=["analysis"])
