"""Supabase Storage fetch helpers for the analysis service.

Fetches are done via the Storage REST API with the service role key so the
service has read access to the private ``plant-images`` bucket. HTTP calls go
through ``httpx`` (already a direct dependency) — no supabase-py needed.

The ``httpx.AsyncClient`` is shared across requests via the FastAPI lifespan
(see ``app.main``) to reuse TCP connections. The module keeps a lazily
constructed fallback so unit tests and scripts that call ``fetch_image_bytes``
without the lifespan still work.
"""

from __future__ import annotations

import base64
import re
from urllib.parse import quote

import httpx

from app.config import settings

BUCKET = "plant-images"

# Accept only characters we'd expect in storage paths we ourselves mint
# (``{growId}/{plantId}/{timestamp}-{hex}.ext``) plus the test fixture shape
# (``foo/bar/baz.jpg``). Anything outside this alphabet — schemes, hosts,
# spaces, percent-encoded segments — is rejected to make SSRF impossible.
_SAFE_PATH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./-]{1,500}$")


class StorageFetchError(RuntimeError):
    """Raised when fetching a private object from Supabase Storage fails."""


_client: httpx.AsyncClient | None = None


def set_client(client: httpx.AsyncClient | None) -> None:
    """Install a shared ``httpx.AsyncClient`` for the process.

    Called by the FastAPI lifespan in ``app.main`` so every request reuses
    the same connection pool. Passing ``None`` clears the client (useful
    during shutdown or tests).
    """
    global _client
    _client = client


def _validate_storage_path(path: str) -> str:
    """Normalize and validate a Supabase Storage object path.

    Strips an optional leading ``plant-images/`` prefix and rejects any value
    that isn't a simple bucket-relative object key. This is a defense-in-depth
    guard: the caller already authorizes the object, but we still refuse any
    input that could escape the ``plant-images`` bucket via path traversal or
    inject a URL via scheme smuggling.
    """
    if not isinstance(path, str):
        raise StorageFetchError("storage path must be a string")
    clean = path.lstrip("/")
    if clean.startswith(f"{BUCKET}/"):
        clean = clean[len(BUCKET) + 1 :]
    if ".." in clean or "\\" in clean:
        raise StorageFetchError("storage path contains forbidden segments")
    if not _SAFE_PATH_RE.match(clean):
        raise StorageFetchError("storage path has invalid characters")
    return clean


async def fetch_image_bytes(storage_path: str, timeout_s: float = 20.0) -> bytes:
    """Fetch raw image bytes from the private Supabase Storage bucket.

    Raises StorageFetchError on any non-200 or network failure.
    """
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise StorageFetchError("Supabase credentials not configured")

    clean_path = _validate_storage_path(storage_path)

    base = settings.supabase_url.rstrip("/")
    url = f"{base}/storage/v1/object/{BUCKET}/{quote(clean_path, safe='/')}"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
    }

    try:
        if _client is not None:
            response = await _client.get(url, headers=headers, timeout=timeout_s)
        else:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
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
