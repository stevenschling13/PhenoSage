from __future__ import annotations

import pytest
from starlette.requests import Request

from app.config import settings
from app.routers.health import readiness_check


def make_request(secret: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if secret:
        headers.append((b"authorization", f"Bearer {secret}".encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/ready",
            "headers": headers,
            "query_string": b"",
        }
    )


@pytest.mark.asyncio
async def test_readiness_returns_ok_when_required_config_is_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "analysis_service_api_key", "prod-secret")
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(settings, "supabase_service_role_key", "service-role")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "readiness_probe_secret", "")

    response = await readiness_check(make_request())

    assert response.status_code == 200
    assert response.body
    assert b'"status":"ok"' in response.body
    assert b'"openai_key":true' in response.body


@pytest.mark.asyncio
async def test_readiness_returns_503_when_production_uses_dev_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "analysis_service_api_key", "dev-api-key")
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(settings, "supabase_service_role_key", "service-role")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "readiness_probe_secret", "")

    response = await readiness_check(make_request())

    assert response.status_code == 503
    assert b'"status":"not_ready"' in response.body
    assert b'"service_api_key":false' in response.body


@pytest.mark.asyncio
async def test_readiness_requires_probe_secret_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "readiness_probe_secret", "probe-secret")

    forbidden = await readiness_check(make_request())
    allowed = await readiness_check(make_request("probe-secret"))

    assert forbidden.status_code == 403
    assert allowed.status_code in {200, 503}
