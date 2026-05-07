from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app


@pytest.mark.asyncio
async def test_ready_returns_ok_when_required_config_is_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "openai-key")
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(settings, "supabase_service_role_key", "service-key")
    monkeypatch.setattr(settings, "analysis_service_api_key", "service-api-key")
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setenv("GIT_COMMIT_SHA", "abc123")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/ready")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["commit"] == "abc123"
    assert all(data["checks"].values())


@pytest.mark.asyncio
async def test_ready_returns_503_when_required_config_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_service_role_key", "")
    monkeypatch.setattr(settings, "analysis_service_api_key", "dev-api-key")
    monkeypatch.setattr(settings, "app_env", "production")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/ready")

    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "not_ready"
    assert data["checks"] == {
        "openai_key": False,
        "supabase_url": False,
        "supabase_service_key": False,
        "service_api_key": False,
    }
