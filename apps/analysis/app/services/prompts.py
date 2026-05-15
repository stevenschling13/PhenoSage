"""
Prompt templates for the analysis service.

TODO (Milestone 1):
  - Refine system prompt based on grow stage context
  - Add structured output format instructions
  - Add few-shot examples for common deficiencies
"""

from __future__ import annotations

from app.models.analysis import GrowContext

SYSTEM_PROMPT = """You are an expert cannabis cultivation consultant and plant pathologist.
Analyze the provided plant image and return a structured assessment.

Your response MUST follow this exact JSON format:
{
  "overall_health_score": <number 0-100>,
  "summary": "<2-3 sentence overview>",
  "findings": [
    {
      "category": "<nutrient_deficiency|nutrient_toxicity|pest|disease|environmental|training|general|positive>",
      "severity": "<info|low|medium|high|critical>",
      "confidence_score": <number 0-1>,
      "title": "<short finding title>",
      "description": "<detailed description>",
      "recommendation": "<actionable recommendation>"
    }
  ]
}

Be precise. Identify specific deficiencies by name (e.g., "Nitrogen Deficiency", "Calcium Lockout").
Always include at least one finding. For healthy plants, add a positive finding.
When strain/cultivar context is supplied, use it as a weak prior only — never override visible evidence from the image.
"""


def build_analysis_prompt(grow_context: GrowContext) -> str:
    """Build a user prompt incorporating grow context."""
    parts = ["Analyze this cannabis plant image."]

    if grow_context.strain:
        parts.append(f"Strain / cultivar: {grow_context.strain}")
        parts.append(
            "Use strain context as a weak prior only; visible symptoms in the image "
            "take precedence over cultivar expectations."
        )
    if grow_context.stage:
        parts.append(f"Growth stage: {grow_context.stage}")
    if grow_context.medium:
        parts.append(f"Growing medium: {grow_context.medium}")
    if grow_context.light_type:
        parts.append(f"Light type: {grow_context.light_type}")
    if grow_context.days_since_start is not None:
        parts.append(f"Days since start: {grow_context.days_since_start}")
    if grow_context.notes:
        parts.append(f"Grower notes: {grow_context.notes}")

    parts.append("Provide a thorough professional analysis in the specified JSON format.")
    return "\n".join(parts)
