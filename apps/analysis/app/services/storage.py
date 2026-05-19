"""Supabase Storage fetch helper, shared by ``image_analysis`` and
``image_comparison``.

The single source of truth for path sanitisation + service-role auth used
by every analysis-side image download. Keeping it in one place ensures the
two production code paths cannot drift on encoding or error classification.
"""

from __future__ import annotations

import re
from urllib.parse import quote

import httpx

from app.config import settings
from app.errors import (
    ConfigurationError,
    InvalidStoragePath,
    StorageUnavailable,
)
from app.middleware import get_request_id

_STORAGE_PATH_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")


def _sanitize_storage_path(storage_path: str) -> str:
    path = storage_path.strip()
    if (
        not path
        or path.startswith("/")
        or path.startswith(".")
        or ".." in path
        or "\\" in path
        or "?" in path
        or "#" in path
        or not _STORAGE_PATH_PATTERN.fullmatch(path)
    ):
        raise InvalidStoragePath()
    return quote(path, safe="/-._~")


async def fetch_image(storage_path: str) -> tuple[bytes, str]:
    """Download an image from Supabase Storage using the service-role key.

    Returns
    -------
    (bytes, content_type) where ``content_type`` is the value of the
    ``content-type`` response header (defaulting to ``image/jpeg``).

    Raises
    ------
    ConfigurationError
        Missing Supabase credentials or service-role rejection (auth/config
        problems are never retried).
    InvalidStoragePath
        Defence-in-depth path-traversal guard.
    StorageUnavailable
        Transient network / 5xx — caller may retry via ``with_retry``.
    """
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise ConfigurationError("Supabase storage credentials are not configured")

    safe_storage_path = _sanitize_storage_path(storage_path)
    base_url = settings.supabase_url.rstrip("/")
    url = (
        f"{base_url}/storage/v1/object/authenticated/plant-images/"
        f"{safe_storage_path}"
    )
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "x-request-id": get_request_id(),
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "image/jpeg")
            return response.content, content_type
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise ConfigurationError(
                "Supabase rejected the service-role credential."
            ) from exc
        raise StorageUnavailable(
            f"Supabase storage returned HTTP {exc.response.status_code}."
        ) from exc
    except (httpx.TimeoutException, httpx.TransportError, ConnectionError) as exc:
        raise StorageUnavailable(
            "Supabase storage is unreachable or timed out."
        ) from exc


__all__ = ["fetch_image"]
