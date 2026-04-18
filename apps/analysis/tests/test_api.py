import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app


@pytest.mark.asyncio
async def test_health_returns_ok() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "phenosage-analysis"


@pytest.mark.asyncio
async def test_analyze_requires_auth() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/analyze",
            json={
                "plant_id": "plant-1",
                "image_id": "img-1",
                "storage_path": "plants/plant-1/img.jpg",
                "grow_context": {"grow_id": "grow-1"},
            },
        )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_analyze_stub_returns_response() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/analyze",
            headers={"Authorization": f"Bearer {settings.analysis_service_api_key}"},
            json={
                "plant_id": "plant-1",
                "image_id": "img-1",
                "storage_path": "plants/plant-1/img.jpg",
                "grow_context": {
                    "grow_id": "grow-1",
                    "strain": "Blue Dream",
                    "stage": "vegetative",
                },
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["plant_id"] == "plant-1"
    assert data["image_id"] == "img-1"
    assert isinstance(data["overall_health_score"], float)
    assert isinstance(data["findings"], list)
    assert len(data["findings"]) >= 1
