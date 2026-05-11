from __future__ import annotations

import pytest

from app.config import settings
from app.routers.health import readiness_check


@pytest.mark.asyncio
async def test_readiness_returns_ok_when_required_config_is_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "analysis_service_api_key", "prod-secret")
    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(settings, "supabase_service_role_key", "service-role")
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")

    response = await readiness_check()

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

    response = await readiness_check()

    assert response.status_code == 503
    assert b'"status":"not_ready"' in response.body
    assert b'"service_api_key":false' in response.body
