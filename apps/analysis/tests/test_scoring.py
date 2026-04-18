import pytest

from app.models.analysis import AnalysisFinding, FindingCategory, FindingSeverity
from app.services.scoring import compute_health_score


def _finding(severity: FindingSeverity) -> AnalysisFinding:
    return AnalysisFinding(
        category=FindingCategory.general,
        severity=severity,
        title="Test",
        description="Test finding",
    )


def test_no_findings_returns_perfect_score() -> None:
    assert compute_health_score([]) == 100.0


def test_info_findings_do_not_penalize() -> None:
    findings = [_finding(FindingSeverity.info)]
    assert compute_health_score(findings) == 100.0


def test_critical_finding_severely_penalizes() -> None:
    findings = [_finding(FindingSeverity.critical)]
    score = compute_health_score(findings)
    assert score < 60.0


def test_multiple_findings_accumulate_penalty() -> None:
    findings = [
        _finding(FindingSeverity.low),
        _finding(FindingSeverity.medium),
        _finding(FindingSeverity.high),
    ]
    score = compute_health_score(findings)
    assert score < 60.0


def test_score_never_goes_below_zero() -> None:
    findings = [_finding(FindingSeverity.critical)] * 10
    assert compute_health_score(findings) >= 0.0


@pytest.mark.parametrize(
    ("severity", "expected"),
    [
        (FindingSeverity.info, 100.0),
        (FindingSeverity.low, 95.0),
        (FindingSeverity.medium, 85.0),
        (FindingSeverity.high, 70.0),
        (FindingSeverity.critical, 50.0),
    ],
)
def test_single_finding_per_severity_matches_weight(
    severity: FindingSeverity, expected: float
) -> None:
    """Each severity penalizes by exactly its declared weight."""
    assert compute_health_score([_finding(severity)]) == expected


def test_info_does_not_dilute_other_penalties() -> None:
    """Info findings must contribute exactly 0, even mixed with real findings."""
    only_high = compute_health_score([_finding(FindingSeverity.high)])
    high_plus_infos = compute_health_score(
        [_finding(FindingSeverity.high)] + [_finding(FindingSeverity.info)] * 5
    )
    assert only_high == high_plus_infos


def test_score_is_order_invariant() -> None:
    """Penalty is a sum, so finding order must not affect the score."""
    findings = [
        _finding(FindingSeverity.low),
        _finding(FindingSeverity.medium),
        _finding(FindingSeverity.high),
        _finding(FindingSeverity.info),
    ]
    forward = compute_health_score(findings)
    reverse = compute_health_score(list(reversed(findings)))
    assert forward == reverse


def test_score_is_rounded_to_one_decimal() -> None:
    """Public contract: score is a float with at most one decimal place."""
    score = compute_health_score([_finding(FindingSeverity.low)] * 3)
    # 100 - 15 = 85.0; whatever the value, it must equal round(score, 1).
    assert score == round(score, 1)


def test_score_within_zero_and_hundred_inclusive() -> None:
    """Score is always within the documented [0, 100] range."""
    for severity in FindingSeverity:
        score = compute_health_score([_finding(severity)] * 20)
        assert 0.0 <= score <= 100.0
