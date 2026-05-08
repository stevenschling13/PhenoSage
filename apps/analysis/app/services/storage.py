"""
Supabase Storage image fetch.

Pulled out of `image_analysis` so both the analysis and comparison
services can fetch by storage path without duplicating the auth + URL
logic.

`storage_path` is user-controlled (it arrives via the Next.js proxy
from a Supabase Storage signed-upload that the user just performed).
Even though the host is fixed to Supabase, partial-SSRF style attacks
matter here: a path containing `..` could escape the `plant-images`
bucket, and URL-meaningful characters (`?`, `#`, `\\`) could change
the request's semantics. We validate the path strictly and URL-encode
each segment before interpolating into the Storage URL.
"""

from __future__ import annotations

import re
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from app.config import settings
from app.middleware import get_request_id

# Allowed shape for a Supabase Storage key inside the `plant-images`
# bucket: alphanumerics, dot, hyphen, underscore, slash.
# Anything else (`..`, `?`, `#`, `\\`, control chars, leading `/`) is
# rejected outright.
_VALID_STORAGE_PATH = re.compile(r"^[A-Za-z0-9._\-/]+$")
_MAX_STORAGE_PATH_LEN = 512


def _validate_storage_path(storage_path: str) -> None:
    """Raise HTTPException(400) for any path that could escape the bucket."""
    if not storage_path or not storage_path.strip():
        raise HTTPException(status_code=400, detail="storage_path is required")
    if len(storage_path) > _MAX_STORAGE_PATH_LEN:
        raise HTTPException(status_code=400, detail="storage_path is too long")
    if storage_path.startswith("/"):
        raise HTTPException(
            status_code=400, detail="storage_path must be relative"
        )
    if not _VALID_STORAGE_PATH.match(storage_path):
        raise HTTPException(
            status_code=400, detail="storage_path contains invalid characters"
        )
    # Block traversal even when each individual segment matches the
    # character class.
    if any(seg in ("", "..", ".") for seg in storage_path.split("/")):
        raise HTTPException(
            status_code=400, detail="storage_path must not contain '..' or empty segments"
        )


async def fetch_storage_image(storage_path: str) -> tuple[bytes, str]:
    """
    Fetch a private plant image from Supabase Storage using the service
    role key. Returns (bytes, content_type).

    Raises:
        HTTPException(400): storage_path is malformed (potential SSRF).
        RuntimeError: storage credentials are missing.
        httpx.HTTPStatusError: storage returned a non-2xx response.
        httpx.HTTPError: transport-level failure.
    """
    _validate_storage_path(storage_path)

    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("Supabase storage credentials are not configured")

    base_url = settings.supabase_url.rstrip("/")
    # `quote` with empty `safe` so `/` is encoded too — but we re-join
    # segments with literal `/` so the bucket subpath structure is
    # preserved while any odd characters inside a segment are escaped.
    encoded = "/".join(quote(seg, safe="") for seg in storage_path.split("/"))
    url = f"{base_url}/storage/v1/object/authenticated/plant-images/{encoded}"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "x-request-id": get_request_id(),
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "image/jpeg")
        return response.content, content_type
