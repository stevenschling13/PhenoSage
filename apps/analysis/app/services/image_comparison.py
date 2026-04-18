"""
Image comparison service.

TODO (Milestone 2):
  - Accept two images and their analysis results
  - Use GPT-4o Vision to describe visible changes between images
  - Return a structured comparison summary
  - Identify improvement/regression trends
"""

from __future__ import annotations


async def compare_images(
    image_id_a: str,
    storage_path_a: str,
    image_id_b: str,
    storage_path_b: str,
) -> str:
    """
    Compare two plant images and return a descriptive summary of changes.
    """
    # TODO: Fetch both images from Supabase Storage
    # TODO: Build comparison prompt
    # TODO: Call OpenAI Vision API
    # TODO: Return structured comparison text

    _ = (image_id_a, storage_path_a, image_id_b, storage_path_b)
    return "Image comparison not yet implemented."
