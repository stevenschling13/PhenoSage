"""Severity-weighted health score.

Penalises each finding by its severity (info contributes nothing) and
subtracts the total from 100. Capped at 0.
"""

from __future__ import annotations

from app.models.analysis import AnalysisFinding, FindingSeverity

SEVERITY_WEIGHTS: dict[FindingSeverity, float] = {
    FindingSeverity.info: 0.0,
    FindingSeverity.low: 5.0,
    FindingSeverity.medium: 15.0,
    FindingSeverity.high: 30.0,
    FindingSeverity.critical: 50.0,
}


def compute_health_score(findings: list[AnalysisFinding]) -> float:
    """
    Compute an overall health score (0–100) from a list of findings.
    100 = perfect health, 0 = critical issues.
    """
    if not findings:
        return 100.0

    penalty = sum(
        SEVERITY_WEIGHTS.get(f.severity, 0.0)
        for f in findings
        if f.severity != FindingSeverity.info
    )
    score = max(0.0, 100.0 - penalty)
    return round(score, 1)
