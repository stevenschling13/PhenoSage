"""
Image comparison service.

Fetches two plant images from Supabase Storage and asks GPT-4o Vision
to describe the visible changes. Returns a single descriptive
paragraph; the analysis pipeline assigns it to
`AnalyzeResponse.comparison_summary`.

Retries (timeout / connection / 5xx / 429) are handled by the same
tenacity policy as the primary analysis call so retries are observable
in logs.
"""

from __future__ import annotations

import base64
import logging

from openai import APIConnectionError, APIStatusError, APITimeoutError
from tenacity import (
    AsyncRetrying,
    RetryCallState,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.config import settings
from app.middleware import get_request_id, log_event
from app.models.analysis import GrowContext
from app.services.openai_client import get_openai_client
from app.services.prompts import COMPARISON_SYSTEM_PROMPT, build_comparison_prompt
from app.services.storage import fetch_storage_image

COMPARISON_MODEL = "gpt-4o-mini-vision"


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (APIConnectionError, APITimeoutError)):
        return True
    if isinstance(exc, APIStatusError):
        return exc.status_code >= 500 or exc.status_code == 429
    return False


def _log_retry(retry_state: RetryCallState) -> None:
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    next_sleep = (
        retry_state.next_action.sleep if retry_state.next_action else None
    )
    log_event(
        logging.WARNING,
        "openai retry (comparison)",
        attempt=retry_state.attempt_number,
        next_sleep_seconds=next_sleep,
        error_type=type(exc).__name__ if exc else None,
        error=str(exc) if exc else None,
    )


def _normalize_mime(content_type: str) -> str:
    return content_type.split(";")[0].strip().lower()


def _data_url(image_bytes: bytes, content_type: str) -> str:
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{_normalize_mime(content_type)};base64,{encoded}"


async def compare_images(
    image_id_a: str,
    storage_path_a: str,
    image_id_b: str,
    storage_path_b: str,
    grow_context: GrowContext | None = None,
) -> str:
    """
    Compare two plant images and return a descriptive summary of changes.

    Image A is the older / "previous" image; image B is the newer
    "current" image. The grow_context, when provided, is forwarded to
    the prompt so the model can ground the diff in the right strain /
    stage context.

    Returns a short plain-language paragraph (no JSON).
    """
    image_a, content_type_a = await fetch_storage_image(storage_path_a)
    image_b, content_type_b = await fetch_storage_image(storage_path_b)

    # Defensive caps on each image.
    for label, payload in (("previous", image_a), ("current", image_b)):
        if len(payload) > settings.image_max_bytes:
            log_event(
                logging.WARNING,
                "image comparison skipped: image exceeds cap",
                label=label,
                size_bytes=len(payload),
                max_bytes=settings.image_max_bytes,
            )
            return (
                "Comparison skipped — one of the images exceeded the size cap. "
                "Re-upload smaller images to enable comparison."
            )

    user_prompt = build_comparison_prompt(grow_context or GrowContext(grow_id="unknown"))

    client = get_openai_client()

    async def _call() -> object:
        return await client.chat.completions.create(
            model=COMPARISON_MODEL,
            max_tokens=400,
            metadata={
                "previous_image_id": image_id_a,
                "current_image_id": image_id_b,
                "request_id": get_request_id(),
                "purpose": "image_comparison",
            },
            messages=[
                {"role": "system", "content": COMPARISON_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "text", "text": "PREVIOUS:"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": _data_url(image_a, content_type_a)
                            },
                        },
                        {"type": "text", "text": "CURRENT:"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": _data_url(image_b, content_type_b)
                            },
                        },
                    ],
                },
            ],
        )

    retrying = AsyncRetrying(
        stop=stop_after_attempt(settings.openai_max_retries + 1),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        retry=retry_if_exception(_is_retryable),
        before_sleep=_log_retry,
        reraise=True,
    )

    completion = None
    async for attempt in retrying:
        with attempt:
            completion = await _call()
    assert completion is not None  # noqa: S101 - tenacity post-condition

    summary = completion.choices[0].message.content or ""  # type: ignore[attr-defined]
    summary = summary.strip()
    if not summary:
        return "No visible changes were identified between the two images."
    return summary
