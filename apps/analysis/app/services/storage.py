"""
Supabase Storage image fetch.

Pulled out of `image_analysis` so both the analysis and comparison
services can fetch by storage path without duplicating the auth + URL
logic.
"""

from __future__ import annotations

import httpx

from app.config import settings
from app.middleware import get_request_id


async def fetch_storage_image(storage_path: str) -> tuple[bytes, str]:
    """
    Fetch a private plant image from Supabase Storage using the service
    role key. Returns (bytes, content_type).

    Raises:
        RuntimeError: storage credentials are missing.
        httpx.HTTPStatusError: storage returned a non-2xx response.
        httpx.HTTPError: transport-level failure.
    """
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase storage credentials are not configured")

    base_url = settings.supabase_url.rstrip("/")
    url = f"{base_url}/storage/v1/object/authenticated/plant-images/{storage_path}"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "x-request-id": get_request_id(),
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "image/jpeg")
        return response.content, content_type
