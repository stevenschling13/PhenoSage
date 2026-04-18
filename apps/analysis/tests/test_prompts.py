"""
Shape / snapshot tests for `app.services.prompts`.

These tests guard the contract between the analysis service and the rest of the
system — specifically, that the structured-output JSON schema described in
`SYSTEM_PROMPT` continues to enumerate every `FindingCategory` and
`FindingSeverity` value defined in `app.models.analysis` (and mirrored in
`packages/shared/src/types.ts`).

If a category or severity is added/renamed without updating the prompt the
model will start emitting values the Pydantic layer rejects.
"""

from __future__ import annotations

import pytest

from app.models.analysis import FindingCategory, FindingSeverity, GrowContext
from app.services.prompts import SYSTEM_PROMPT, build_analysis_prompt


@pytest.mark.parametrize("category", list(FindingCategory))
def test_system_prompt_lists_every_finding_category(category: FindingCategory) -> None:
    assert category.value in SYSTEM_PROMPT, (
        f"SYSTEM_PROMPT is missing category {category.value}; update prompts.py "
        f"whenever FindingCategory changes."
    )


@pytest.mark.parametrize("severity", list(FindingSeverity))
def test_system_prompt_lists_every_finding_severity(severity: FindingSeverity) -> None:
    assert severity.value in SYSTEM_PROMPT, (
        f"SYSTEM_PROMPT is missing severity {severity.value}; update prompts.py "
        f"whenever FindingSeverity changes."
    )


def test_system_prompt_documents_required_top_level_keys() -> None:
    for key in ("overall_health_score", "summary", "findings"):
        assert key in SYSTEM_PROMPT


def test_system_prompt_documents_required_finding_keys() -> None:
    for key in ("category", "severity", "title", "description", "recommendation"):
        assert key in SYSTEM_PROMPT


def test_build_analysis_prompt_minimum_grow_context() -> None:
    """With only the required field, the prompt must still be well-formed."""
    prompt = build_analysis_prompt(GrowContext(grow_id="grow-1"))
    assert prompt.startswith("Analyze this cannabis plant image.")
    assert prompt.endswith(
        "Provide a thorough professional analysis in the specified JSON format."
    )
    # No optional field labels should leak when their values are absent.
    for label in ("Strain:", "Growth stage:", "Growing medium:", "Light type:",
                  "Days since start:", "Grower notes:"):
        assert label not in prompt


def test_build_analysis_prompt_includes_every_supplied_field() -> None:
    ctx = GrowContext(
        grow_id="grow-1",
        strain="Blue Dream",
        stage="vegetative",
        medium="coco",
        light_type="led",
        days_since_start=21,
        notes="Yellowing on lower fan leaves.",
    )
    prompt = build_analysis_prompt(ctx)
    assert "Strain: Blue Dream" in prompt
    assert "Growth stage: vegetative" in prompt
    assert "Growing medium: coco" in prompt
    assert "Light type: led" in prompt
    assert "Days since start: 21" in prompt
    assert "Grower notes: Yellowing on lower fan leaves." in prompt


def test_build_analysis_prompt_includes_zero_days_since_start() -> None:
    """`0` is a valid value and must not be dropped (regression guard for `if x`)."""
    ctx = GrowContext(grow_id="grow-1", days_since_start=0)
    prompt = build_analysis_prompt(ctx)
    assert "Days since start: 0" in prompt
