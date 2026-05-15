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

    monkeypatch.setattr(image_analysis.httpx, "AsyncClient", FakeClient)

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
    async def fake_fetch(storage_path: str) -> tuple[bytes, str]:
        raise image_analysis.StorageUnavailable("simulated outage")

    monkeypatch.setattr(image_analysis, "_fetch_storage_image", fake_fetch)

    with caplog.at_level("WARNING", logger="phenosage.analysis"):
        response = await image_analysis.run_analysis(_request())

    assert response.is_fallback is True
    assert response.analysis_mode == "fallback"
    # Stable, redaction-safe code — never the raw exception class name.
    assert response.fallback_reason == "STORAGE_UNAVAILABLE"
    assert "analysis fallback triggered" in caplog.text


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
