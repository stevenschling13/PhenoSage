from __future__ import annotations

import base64
import json

from openai import AsyncOpenAI

from app.config import settings
from app.models.analysis import ComparisonTrendDirection, ImageComparisonResult
from app.services.image_analysis import _fetch_storage_image


async def compare_images(
    image_id_a: str,
    storage_path_a: str,
    image_id_b: str,
    storage_path_b: str,
) -> ImageComparisonResult:
    image_a, content_type_a = await _fetch_storage_image(storage_path_a)
    image_b, content_type_b = await _fetch_storage_image(storage_path_b)

    if not settings.openai_api_key:
        return ImageComparisonResult(
            changes=["Comparison inconclusive: OPENAI_API_KEY not configured."],
            likely_trend_direction=ComparisonTrendDirection.inconclusive,
            confidence=0.0,
            caveats=["Model unavailable."],
        )

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    encoded_a = base64.b64encode(image_a).decode("utf-8")
    encoded_b = base64.b64encode(image_b).decode("utf-8")

    prompt = (
        "Compare image A (older) and image B (newer) for cannabis plant health trends. "
        "Return strict JSON with keys: changes (string[]), likelyTrendDirection "
        "(improving|stable|regressing|inconclusive), confidence (0..1), caveats (string[])."
    )

    completion = await client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": "You are a cautious plant-health comparison assistant."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "text", "text": f"Image A id: {image_id_a}"},
                    {"type": "image_url", "image_url": {"url": f"data:{content_type_a};base64,{encoded_a}"}},
                    {"type": "text", "text": f"Image B id: {image_id_b}"},
                    {"type": "image_url", "image_url": {"url": f"data:{content_type_b};base64,{encoded_b}"}},
                ],
            },
        ],
    )

    raw = completion.choices[0].message.content or "{}"
    parsed = json.loads(raw)

    direction = parsed.get("likelyTrendDirection", "inconclusive")
    if direction not in {"improving", "stable", "regressing", "inconclusive"}:
        direction = "inconclusive"

    return ImageComparisonResult(
        changes=[str(item) for item in parsed.get("changes", []) if isinstance(item, str)],
        likely_trend_direction=ComparisonTrendDirection(direction),
        confidence=float(parsed.get("confidence", 0.0)),
        caveats=[str(item) for item in parsed.get("caveats", []) if isinstance(item, str)],
    )
