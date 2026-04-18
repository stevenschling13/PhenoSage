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
