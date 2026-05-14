"""Tests for the typed analysis error hierarchy + FastAPI handler envelope."""

from __future__ import annotations

import json
import sys
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.errors import (
    AnalysisError,
    ConfigurationError,
    ModelBadResponse,
    ModelRateLimited,
    ModelUnavailable,
    StorageUnavailable,
)
from app.main import app
from app.models.analysis import AnalyzeRequest
from app.services import image_analysis

client = TestClient(app)


def test_typed_errors_have_stable_codes_and_status() -> None:
    # These codes are part of the API contract — adding new ones is fine,
    # changing or removing one is a breaking change for the web proxy.
    assert StorageUnavailable.code == "STORAGE_UNAVAILABLE"
    assert StorageUnavailable.status_code == 503
    assert StorageUnavailable.retryable is True

    assert ModelUnavailable.code == "MODEL_UNAVAILABLE"
    assert ModelRateLimited.code == "MODEL_RATE_LIMITED"
    assert ModelRateLimited.status_code == 429

    assert ModelBadResponse.code == "MODEL_BAD_RESPONSE"
    assert ModelBadResponse.retryable is False

    assert ConfigurationError.code == "CONFIGURATION_ERROR"
    assert ConfigurationError.retryable is False


def test_typed_errors_default_message_is_redaction_safe() -> None:
    # Defaults must never embed env-var names, signed URLs, or provider text.
    for cls in (
        StorageUnavailable,
        ModelUnavailable,
        ModelRateLimited,
        ModelBadResponse,
        ConfigurationError,
    ):
        msg = cls().default_message
        assert "supabase" not in msg.lower()
        assert "openai" not in msg.lower()
        assert "api_key" not in msg.lower()
        assert "bearer" not in msg.lower()


def test_analysis_error_handler_returns_safe_envelope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A typed exception thrown from the analyze route must be JSON-enveloped.

    We stub `run_analysis` to raise `ModelUnavailable` and assert the
    response shape — `error.code`, `error.message`, `error.request_id`,
    `retryable`. Critically, the chained `__cause__` must NOT appear in
    the response body.
    """

    async def fake_run_analysis(_request: AnalyzeRequest) -> object:
        raise ModelUnavailable("openai gateway 502 — DO NOT LEAK") from RuntimeError(
            "raw provider body with secret_token=sk_live_xxx"
        )

    monkeypatch.setattr(
        "app.routers.analyze.run_analysis", fake_run_analysis
    )
    monkeypatch.setattr(settings, "analysis_service_api_key", "test-key")

    response = client.post(
        "/analyze",
        json={
            "plant_id": "p1",
            "image_id": "i1",
            "storage_path": "plants/p1/i1.jpg",
            "grow_context": {"grow_id": "g1"},
        },
        headers={"Authorization": "Bearer test-key"},
    )
    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "MODEL_UNAVAILABLE"
    # The default message is what's surfaced — never the raw exception text.
    assert body["error"]["message"] == ModelUnavailable.default_message
    assert "request_id" in body["error"]
    assert body["retryable"] is True

    # Belt-and-braces: nothing from the chained cause leaks.
    raw = json.dumps(body)
    assert "DO NOT LEAK" not in raw
    assert "secret_token" not in raw
    assert "sk_live" not in raw


@pytest.mark.asyncio
async def test_run_model_analysis_classifies_invalid_json_as_bad_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    class FakeCompletions:
        async def create(self, **_: object) -> object:
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content="not-valid-json{{{")
                    )
                ]
            )

    class FakeAsyncOpenAI:
        def __init__(self, *, api_key: str) -> None:
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(
        sys.modules, "openai", SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI)
    )

    with pytest.raises(ModelBadResponse):
        await image_analysis._run_model_analysis(
            AnalyzeRequest(
                plant_id="p1",
                image_id="i1",
                storage_path="plants/p1/i1.jpg",
                grow_context={"grow_id": "g1"},
            ),
            image_bytes=b"x",
            content_type="image/jpeg",
        )


@pytest.mark.asyncio
async def test_run_model_analysis_classifies_429_as_rate_limited(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")

    class FakeRateLimitError(Exception):
        """Mimics openai.RateLimitError class name."""

    FakeRateLimitError.__name__ = "RateLimitError"

    class FakeCompletions:
        async def create(self, **_: object) -> object:
            raise FakeRateLimitError("openai rate limit")

    class FakeAsyncOpenAI:
        def __init__(self, *, api_key: str) -> None:
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(
        sys.modules, "openai", SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI)
    )

    with pytest.raises(ModelRateLimited):
        await image_analysis._run_model_analysis(
            AnalyzeRequest(
                plant_id="p1",
                image_id="i1",
                storage_path="plants/p1/i1.jpg",
                grow_context={"grow_id": "g1"},
            ),
            image_bytes=b"x",
            content_type="image/jpeg",
        )


def test_analysis_error_is_abstract_enough_to_subclass() -> None:
    class CustomFailure(AnalysisError):  # noqa: N818 — subclass of AnalysisError
        code = "CUSTOM_FAILURE"
        status_code = 500
        retryable = False
        default_message = "Custom failure for tests."

    err = CustomFailure()
    assert err.code == "CUSTOM_FAILURE"
    assert str(err) == "Custom failure for tests."
