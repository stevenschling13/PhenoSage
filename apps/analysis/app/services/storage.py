"""Supabase Storage fetch helpers for the analysis service.

Fetches are done via the Storage REST API with the service role key so the
service has read access to the private ``plant-images`` bucket. HTTP calls go
through ``httpx`` (already a direct dependency) — no supabase-py needed.
"""

from __future__ import annotations

import base64
import re
from urllib.parse import quote

import httpx

from app.config import settings

BUCKET = "plant-images"
_VALID_PATH_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
_http_client: httpx.AsyncClient | None = None


class StorageFetchError(RuntimeError):
    """Raised when fetching a private object from Supabase Storage fails."""


def _normalize_storage_path(storage_path: str) -> str:
    clean_path = storage_path.strip().lstrip("/")
    if clean_path.startswith(f"{BUCKET}/"):
        clean_path = clean_path[len(BUCKET) + 1 :]

    if not clean_path:
        raise StorageFetchError("storage path is empty")
    if "://" in clean_path or clean_path.startswith(("http:", "https:")):
        raise StorageFetchError("storage path must be relative")
    if "\\" in clean_path or clean_path.startswith("/"):
        raise StorageFetchError("storage path is invalid")
    if not _VALID_PATH_RE.fullmatch(clean_path):
        raise StorageFetchError("storage path contains invalid characters")

    parts = clean_path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise StorageFetchError("storage path is invalid")

    return clean_path


def get_http_client(timeout_s: float = 20.0) -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=timeout_s)
    else:
        _http_client.timeout = httpx.Timeout(timeout_s)
    return _http_client


async def close_http_client() -> None:
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
    _http_client = None


async def fetch_image_bytes(storage_path: str, timeout_s: float = 20.0) -> bytes:
    """Fetch raw image bytes from the private Supabase Storage bucket.

    Raises StorageFetchError on any non-200 or network failure.
    """
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise StorageFetchError("Supabase credentials not configured")

    clean_path = _normalize_storage_path(storage_path)

    base = settings.supabase_url.rstrip("/")
    url = f"{base}/storage/v1/object/{BUCKET}/{quote(clean_path, safe='/')}"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
    }
    try:
        client = get_http_client(timeout_s)
        response = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise StorageFetchError(f"storage network error: {exc}") from exc

    if response.status_code != 200:
        raise StorageFetchError(
            f"storage returned {response.status_code} for {storage_path}"
        )
    return response.content


def image_to_data_url(image_bytes: bytes, content_type: str = "image/jpeg") -> str:
    """Encode image bytes as a data URL suitable for OpenAI Vision image_url input."""
    b64 = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{content_type};base64,{b64}"


def guess_content_type(storage_path: str) -> str:
    lower = storage_path.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".heic"):
        return "image/heic"
    return "image/jpeg"
