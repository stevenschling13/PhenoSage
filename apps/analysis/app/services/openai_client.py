"""Shared OpenAI client + domain error.

Extracted to its own module so ``image_analysis`` and ``image_comparison`` can
share a single lazily-constructed ``AsyncOpenAI`` without importing each other.
"""

from __future__ import annotations

from openai import AsyncOpenAI

from app.config import settings


class AnalysisError(RuntimeError):
    """Raised when the analysis pipeline cannot produce a structured response."""


_client: AsyncOpenAI | None = None


def get_openai_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        if not settings.openai_api_key:
            raise AnalysisError("OPENAI_API_KEY not configured")
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client
