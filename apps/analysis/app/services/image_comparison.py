"""Image-comparison stub (Milestone 2).

Intentionally unimplemented. The active analysis path in
``image_analysis.run_analysis`` hardcodes ``comparison_summary=None`` and
the web client only renders a comparison block when that field is truthy
(see ``apps/web/src/app/(app)/plants/[plantId]/page.tsx``), so users
never see a placeholder string. The defensive sentinel below ensures
this function cannot be wired into a production path by accident — a
future PR that ships real comparison logic must replace the body
wholesale, not extend it.
"""

from __future__ import annotations


async def compare_images(
    image_id_a: str,
    storage_path_a: str,
    image_id_b: str,
    storage_path_b: str,
) -> str:
    """Compare two plant images and return a descriptive summary of changes.

    Raises
    ------
    NotImplementedError
        Always. Until Milestone 2 implements real comparison, calling this
        from a production path is a bug — surface it loudly instead of
        returning a misleading placeholder string.
    """
    _ = (image_id_a, storage_path_a, image_id_b, storage_path_b)
    raise NotImplementedError(
        "Image comparison is not yet implemented (Milestone 2). "
        "The active analysis path must not call this function."
    )
