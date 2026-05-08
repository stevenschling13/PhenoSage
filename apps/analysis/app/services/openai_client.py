"""
Shared AsyncOpenAI client.

A module-level singleton with timeout and retry config from settings.
We set OpenAI's built-in `max_retries=0` because retries are owned by
tenacity in `image_analysis` / `image_comparison` — that gives us
per-attempt logging tagged with the request id, which the SDK's
internal retry loop does not provide.

`reset_openai_client()` is a test hook: clears the singleton so a
test can override `settings.openai_api_key` and re-instantiate.
"""

from __future__ import annotations

from openai import AsyncOpenAI

from app.config import settings

_client: AsyncOpenAI | None = None


def get_openai_client() -> AsyncOpenAI:
    global _client
    if _client is not None:
        return _client
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    _client = AsyncOpenAI(
        api_key=settings.openai_api_key,
        timeout=settings.openai_timeout_seconds,
        max_retries=0,
    )
    return _client


def reset_openai_client() -> None:
    """Test-only. Clear the cached client so the next call re-reads settings."""
    global _client
    _client = None
