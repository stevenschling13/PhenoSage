"""Image comparison service — brief natural-language diff between two images."""

from __future__ import annotations

import logging

from app.services.storage import (
    StorageFetchError,
    fetch_image_bytes,
    guess_content_type,
    image_to_data_url,
)

logger = logging.getLogger(__name__)

COMPARE_SYSTEM = (
    "You are comparing two successive photos of the same cannabis plant. "
    "Describe, in 2-3 sentences, the visible changes between the earlier image "
    "and the latest image: growth, color shifts, stress signs, training, or "
    "deficiencies. Do not invent numeric measurements. Return plain text only."
)


async def compare_images(
    image_id_a: str,
    storage_path_a: str,
    image_id_b: str,
    storage_path_b: str,
) -> str:
    """Return a short comparison summary between two plant images.

    ``image_id_a`` is the *current* image, ``image_id_b`` is the *previous* image.
    Falls back to a neutral message if either image cannot be fetched or the
    Vision call fails.
    """
    # Import lazily so the main analysis path isn't held up if this module is
    # only used occasionally; also avoids a circular import with image_analysis.
    from app.services.image_analysis import AnalysisError, get_openai_client

    try:
        current = await fetch_image_bytes(storage_path_a)
        previous = await fetch_image_bytes(storage_path_b)
    except StorageFetchError as exc:
        logger.info("comparison skipped, storage fetch failed: %s", exc)
        return ""

    current_url = image_to_data_url(current, guess_content_type(storage_path_a))
    previous_url = image_to_data_url(previous, guess_content_type(storage_path_b))

    try:
        client = get_openai_client()
    except AnalysisError:
        return ""

    try:
        response = await client.chat.completions.create(
            model="gpt-4o",
            temperature=0.2,
            max_tokens=300,
            messages=[
                {"role": "system", "content": COMPARE_SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Previous image:"},
                        {"type": "image_url", "image_url": {"url": previous_url}},
                        {"type": "text", "text": "Current image:"},
                        {"type": "image_url", "image_url": {"url": current_url}},
                        {"type": "text", "text": "Summarize visible changes."},
                    ],
                },
            ],
        )
    except Exception as exc:  # noqa: BLE001 - comparison is best-effort
        logger.info("comparison vision call failed: %s", exc)
        return ""

    choice = response.choices[0] if response.choices else None
    content = choice.message.content if choice and choice.message else None
    _ = image_id_a, image_id_b
    return (content or "").strip()
