from __future__ import annotations

import io
import itertools
import json
import random
import sys
from types import SimpleNamespace

import pytest
from PIL import Image

from app.config import settings
from app.models.analysis import AnalyzeRequest
from app.services import image_analysis
from app.services import storage as storage_service


def _valid_png_bytes() -> bytes:
    """A 256×256 mid-luminance noisy PNG that passes ``assess_image_quality``.

    Used by tests that exercise the full ``run_analysis`` happy path; the
    pre-vision quality gate would reject the previous ``b"image-bytes"``
    stubs used here.
    """
    rng = random.Random(1)
    img = Image.new("L", (256, 256))
    px = img.load()
    assert px is not None
    for y, x in itertools.product(range(256), range(256)):
        px[x, y] = rng.randint(60, 180)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _request() -> AnalyzeRequest:
    return AnalyzeRequest(
        plant_id="plant-1",
        image_id="image-1",
        storage_path="plants/plant-1/image.jpg",
        grow_context={"grow_id": "grow-1", "strain": "Blue Dream"},
        previous_image_id="previous-image",
    )


@pytest.mark.asyncio
async def test_run_analysis_returns_inconclusive_fallback_when_storage_is_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_service_role_key", "")

    response = await image_analysis.run_analysis(_request())

    assert response.analysis_mode == "fallback"
    assert response.is_fallback is True
    assert response.fallback_reason == "CONFIGURATION_ERROR"
    assert response.overall_health_score == 0.0
    assert "Inconclusive fallback result" in response.summary
    assert response.compared_to_image_id == "previous-image"
    assert response.findings[0].title == "Fallback analysis only"
    assert response.findings[0].confidence_score == 0.0


@pytest.mark.asyncio
async def test_run_analysis_returns_inconclusive_when_image_quality_gate_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A blank/garbage image must short-circuit before the model is called.

    Pins Rule 9 (Plant-Health Output Discipline): the user-visible result
    becomes an explicit *inconclusive* envelope instead of a low-confidence
    diagnosis from the vision model.
    """
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    async def fake_fetch(_path: str) -> tuple[bytes, str]:
        # Bytes that Pillow cannot decode → image_decode_failed reason
        # → ImageQualityInconclusive → inconclusive fallback envelope.
        return b"not-an-image", "image/jpeg"

    monkeypatch.setattr(image_analysis, "_fetch_storage_image", fake_fetch)

    # Belt-and-braces: prove the model branch is never reached.
    async def explode(*_a: object, **_kw: object) -> object:
        raise AssertionError("vision model must not be called on bad images")

    monkeypatch.setattr(image_analysis, "_run_model_analysis", explode)

    response = await image_analysis.run_analysis(_request())

    assert response.analysis_mode == "fallback"
    assert response.is_fallback is True
    assert response.fallback_reason == "IMAGE_QUALITY_INCONCLUSIVE"
    assert response.overall_health_score == 0.0
    assert response.findings[0].title == "Fallback analysis only"


@pytest.mark.asyncio
async def test_run_analysis_logs_image_quality_reason_on_gate_failure(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The granular image-quality reason must appear in the fallback log.

    Logging only exc.code ("IMAGE_QUALITY_INCONCLUSIVE") is too coarse for
    ops triage; the specific reason (e.g. "image_decode_failed") should be
    present so engineers can distinguish actionable causes like `too_dark` vs
    `too_blurry` without having to pull raw images.
    """
    import json as _json

    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    async def fake_fetch(_path: str) -> tuple[bytes, str]:
        return b"not-an-image", "image/jpeg"

    monkeypatch.setattr(image_analysis, "_fetch_storage_image", fake_fetch)

    with caplog.at_level("WARNING"):
        await image_analysis.run_analysis(_request())

    # log_event serialises all fields as a JSON string in the log message.
    fallback_payloads = []
    for record in caplog.records:
        try:
            payload = _json.loads(record.getMessage())
        except (_json.JSONDecodeError, TypeError):
            continue
        if payload.get("message") == "analysis fallback triggered":
            fallback_payloads.append(payload)

    assert fallback_payloads, "expected an 'analysis fallback triggered' log entry"
    assert fallback_payloads[0].get("image_quality_reason") == "image_decode_failed", (
        "fallback log must include image_quality_reason for ops triage"
    )


@pytest.mark.asyncio
async def test_run_model_analysis_parses_structured_model_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            assert kwargs["model"] == image_analysis.MODEL_VERSION
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(
                                {
                                    "overall_health_score": 74,
                                    "summary": "Mild deficiency detected.",
                                    "findings": [
                                        {
                                            "category": "nutrient_deficiency",
                                            "severity": "medium",
                                            "confidence_score": 0.78,
                                            "title": "Magnesium deficiency",
                                            "description": "Interveinal chlorosis.",
                                            "recommendation": "Add Cal-Mag.",
                                        }
                                    ],
                                }
                            )
                        )
                    )
                ]
            )

    class FakeAsyncOpenAI:
        def __init__(self, *, api_key: str) -> None:
            assert api_key == "sk-test"
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(
        sys.modules,
        "openai",
        SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI),
    )

    response = await image_analysis._run_model_analysis(
        _request(),
        image_bytes=b"fake-image",
        content_type="image/jpeg",
    )

    assert response.analysis_mode == "model"
    assert response.is_fallback is False
    assert response.overall_health_score == 74.0
    assert response.summary == "Mild deficiency detected."
    assert response.findings[0].title == "Magnesium deficiency"
    assert response.findings[0].confidence_score == 0.78
    assert response.findings[0].recommendation == "Add Cal-Mag."
    assert response.compared_to_image_id == "previous-image"


@pytest.mark.asyncio
async def test_run_model_analysis_uses_low_confidence_defaults_for_incomplete_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(
                                {
                                    "overall_health_score": "unknown",
                                    "summary": "",
                                    "findings": [],
                                }
                            )
                        )
                    )
                ]
            )

    class FakeAsyncOpenAI:
        def __init__(self, *, api_key: str) -> None:
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(
        sys.modules,
        "openai",
        SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI),
    )

    response = await image_analysis._run_model_analysis(
        _request(),
        image_bytes=b"fake-image",
        content_type="image/png",
    )

    assert response.analysis_mode == "model"
    assert response.summary == (
        "Image reviewed successfully, but the returned summary was incomplete."
    )
    assert response.findings[0].title == "No issues confidently identified"
    assert response.findings[0].confidence_score == 0.15
    assert response.overall_health_score == 100.0


@pytest.mark.asyncio
async def test_run_model_analysis_raises_configuration_when_openai_key_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "")

    with pytest.raises(image_analysis.ConfigurationError):
        await image_analysis._run_model_analysis(
            _request(),
            image_bytes=b"fake-image",
            content_type="image/jpeg",
        )


def test_parse_findings_returns_empty_list_for_non_list_input() -> None:
    assert image_analysis._parse_findings("not-a-list") == []
    assert image_analysis._parse_findings(None) == []
    assert image_analysis._parse_findings({"finding": "x"}) == []


def test_parse_findings_skips_non_dict_items() -> None:
    raw = [
        "string-item",
        42,
        None,
        {
            "category": "pest",
            "severity": "high",
            "title": "Spider mites",
            "description": "Webbing on undersides.",
            "recommendation": "Apply neem oil.",
        },
    ]

    findings = image_analysis._parse_findings(raw)

    assert len(findings) == 1
    assert findings[0].title == "Spider mites"


@pytest.mark.asyncio
async def test_fetch_storage_image_raises_configuration_when_credentials_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_service_role_key", "")

    with pytest.raises(image_analysis.ConfigurationError):
        await image_analysis._fetch_storage_image("plants/p/img.jpg")


@pytest.mark.asyncio
async def test_fetch_storage_image_returns_bytes_and_content_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co/")
    monkeypatch.setattr(settings, "supabase_service_role_key", "service-role")

    captured: dict[str, object] = {}

    class FakeResponse:
        def __init__(self) -> None:
            self.content = b"image-payload"
            self.headers = {"content-type": "image/png"}

        def raise_for_status(self) -> None:
            captured["raised"] = True

    class FakeClient:
        def __init__(self, *, timeout: float) -> None:
            captured["timeout"] = timeout

        async def __aenter__(self) -> FakeClient:
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def get(self, url: str, headers: dict[str, str]) -> FakeResponse:
            captured["url"] = url
            captured["headers"] = headers
            return FakeResponse()

    # `image_analysis._fetch_storage_image` is an alias for
    # `app.services.storage.fetch_image`; patching the storage module's
    # httpx is the only seam that actually intercepts the network call.
    monkeypatch.setattr(storage_service.httpx, "AsyncClient", FakeClient)

    body, content_type = await image_analysis._fetch_storage_image("plants/p/img.jpg")

    assert body == b"image-payload"
    assert content_type == "image/png"
    assert captured["timeout"] == 20.0
    assert captured["url"] == (
        "https://example.supabase.co/storage/v1/object/authenticated/plant-images/plants/p/img.jpg"
    )
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers["Authorization"] == "Bearer service-role"
    assert "x-request-id" in headers
    assert captured["raised"] is True


@pytest.mark.asyncio
async def test_run_analysis_happy_path_logs_completion(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_service_role_key", "service-role")
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        assert storage_path == "plants/plant-1/image.jpg"
        return _valid_png_bytes(), "image/png"

    monkeypatch.setattr(image_analysis, "_fetch_storage_image", fake_fetch)

    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(
                                {
                                    "overall_health_score": 88,
                                    "summary": "Healthy plant.",
                                    "findings": [
                                        {
                                            "category": "general",
                                            "severity": "info",
                                            "title": "Looks good",
                                            "description": "No issues observed.",
                                            "recommendation": "Continue current regimen.",
                                        }
                                    ],
                                }
                            )
                        )
                    )
                ]
            )

    class FakeAsyncOpenAI:
        def __init__(self, *, api_key: str) -> None:
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(
        sys.modules,
        "openai",
        SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI),
    )

    with caplog.at_level("INFO", logger="phenosage.analysis"):
        response = await image_analysis.run_analysis(_request())

    assert response.analysis_mode == "model"
    assert response.is_fallback is False
    assert response.fallback_reason is None
    assert response.overall_health_score == 88.0
    assert response.summary == "Healthy plant."
    assert "analysis completed" in caplog.text


@pytest.mark.asyncio
async def test_run_analysis_falls_back_when_storage_fetch_fails(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    calls = 0

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        nonlocal calls
        calls += 1
        raise image_analysis.StorageUnavailable("simulated outage")

    # No-op sleep so we don't pay real backoff time in unit tests.
    async def _no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(image_analysis, "_fetch_storage_image", fake_fetch)
    monkeypatch.setattr(
        "app.services.retry._DEFAULT_SLEEP",
        _no_sleep,
    )

    with caplog.at_level("WARNING", logger="phenosage.analysis"):
        response = await image_analysis.run_analysis(_request())

    # Storage fetch is retried (default 3 attempts) before falling back.
    assert calls == 3
    assert response.is_fallback is True
    assert response.analysis_mode == "fallback"
    # Stable, redaction-safe code — never the raw exception class name.
    assert response.fallback_reason == "STORAGE_UNAVAILABLE"
    assert "analysis fallback triggered" in caplog.text


@pytest.mark.asyncio
async def test_run_analysis_retries_storage_fetch_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A single transient storage blip must not surface as a fallback.

    Locks in the Phase 1 reliability behaviour: the user-visible result
    after one retryable failure should be a real analysis, not the
    inconclusive fallback envelope.
    """
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    attempts = 0

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise image_analysis.StorageUnavailable("transient blip")
        return _valid_png_bytes(), "image/png"

    monkeypatch.setattr(image_analysis, "_fetch_storage_image", fake_fetch)

    async def _no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("app.services.retry._DEFAULT_SLEEP", _no_sleep)

    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(
                                {
                                    "overall_health_score": 91,
                                    "summary": "Healthy.",
                                    "findings": [],
                                }
                            )
                        )
                    )
                ]
            )

    class FakeAsyncOpenAI:
        def __init__(self, *, api_key: str) -> None:
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(
        sys.modules,
        "openai",
        SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI),
    )

    response = await image_analysis.run_analysis(_request())

    assert attempts == 2
    assert response.is_fallback is False
    assert response.analysis_mode == "model"
    assert response.overall_health_score == 91.0


@pytest.mark.asyncio
async def test_run_analysis_retries_model_then_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A single model rate-limit must be absorbed by the retry layer.

    The image bytes are captured by the closure, so a retried model call
    must not re-download the image — exercised by asserting the storage
    fetch ran exactly once.
    """
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    fetch_calls = 0

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        nonlocal fetch_calls
        fetch_calls += 1
        return _valid_png_bytes(), "image/png"

    monkeypatch.setattr(image_analysis, "_fetch_storage_image", fake_fetch)

    async def _no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("app.services.retry._DEFAULT_SLEEP", _no_sleep)

    model_calls = 0

    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            nonlocal model_calls
            model_calls += 1
            if model_calls == 1:
                raise image_analysis.ModelRateLimited("burst")
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps(
                                {
                                    "overall_health_score": 80,
                                    "summary": "Recovered.",
                                    "findings": [],
                                }
                            )
                        )
                    )
                ]
            )

    class FakeAsyncOpenAI:
        def __init__(self, *, api_key: str) -> None:
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(
        sys.modules,
        "openai",
        SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI),
    )

    response = await image_analysis.run_analysis(_request())

    assert fetch_calls == 1, "storage must not be re-fetched on a model retry"
    assert model_calls == 2
    assert response.is_fallback is False
    assert response.overall_health_score == 80.0


@pytest.mark.asyncio
async def test_run_analysis_does_not_swallow_programmer_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Programmer defects must propagate, not become a fake fallback diagnosis.

    The plant-health output discipline (see .github/copilot-instructions.md
    §9) bans presenting an unexpected internal bug as a confident-looking
    inconclusive result. Anything that isn't an `AnalysisError` re-raises.
    """

    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        raise TypeError("oops, programmer bug — null deref")

    monkeypatch.setattr(image_analysis, "_fetch_storage_image", fake_fetch)

    with pytest.raises(TypeError, match="programmer bug"):
        await image_analysis.run_analysis(_request())


@pytest.mark.parametrize(
    "bad_path",
    [
        "../../etc/passwd",
        "/absolute/path.jpg",
        "plants/../../../secret.jpg",
        "plants//double-slash.jpg",
        "plants/img.jpg?query=1",
        "plants/img.jpg#frag",
        "http://evil.com/img.jpg",
        "plants/img .jpg",
        "plants\\img.jpg",
        "",
        "a" * 600,
    ],
)
def test_analyze_request_rejects_unsafe_storage_paths(bad_path: str) -> None:
    """SSRF guard: storage_path values that could escape the bucket must fail validation."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        AnalyzeRequest(
            plant_id="plant-1",
            image_id="image-1",
            storage_path=bad_path,
            grow_context={"grow_id": "grow-1"},
        )


def test_analyze_request_accepts_safe_storage_paths() -> None:
    for good in [
        "plants/plant-1/image.jpg",
        "user-123/plant_abc/2026-01-01-leaf.png",
        "single-segment.jpg",
    ]:
        req = AnalyzeRequest(
            plant_id="plant-1",
            image_id="image-1",
            storage_path=good,
            grow_context={"grow_id": "grow-1"},
            previous_storage_path=good,
        )
        assert req.storage_path == good
        assert req.previous_storage_path == good
