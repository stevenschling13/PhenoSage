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


@pytest.mark.asyncio
async def test_health_does_not_require_auth() -> None:
    """`/health` is the one route that must be reachable without a bearer token."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")  # no Authorization header
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_analyze_rejects_wrong_bearer_token() -> None:
    """A syntactically-valid but incorrect token must be rejected."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/analyze",
            headers={"Authorization": "Bearer not-the-right-key"},
            json={
                "plant_id": "plant-1",
                "image_id": "img-1",
                "storage_path": "plants/plant-1/img.jpg",
                "grow_context": {"grow_id": "grow-1"},
            },
        )
    assert response.status_code == 401
    # Error body must not echo the rejected credential.
    assert "not-the-right-key" not in response.text


@pytest.mark.asyncio
async def test_analyze_returns_422_when_required_fields_missing() -> None:
    """Pydantic validation must reject bodies missing `plant_id` etc."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/analyze",
            headers={"Authorization": f"Bearer {settings.analysis_service_api_key}"},
            json={
                # missing plant_id
                "image_id": "img-1",
                "storage_path": "plants/plant-1/img.jpg",
                "grow_context": {"grow_id": "grow-1"},
            },
        )
    assert response.status_code == 422
    body = response.json()
    # FastAPI/Pydantic v2 surfaces the offending field in `detail`.
    assert any("plant_id" in str(err) for err in body.get("detail", []))


@pytest.mark.asyncio
async def test_analyze_rejects_non_json_body() -> None:
    """A request with the wrong content type must not crash the server."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/analyze",
            headers={
                "Authorization": f"Bearer {settings.analysis_service_api_key}",
                "Content-Type": "text/plain",
            },
            content="not json",
        )
    # FastAPI returns 422 (validation) for unparseable JSON bodies.
    assert response.status_code in (400, 415, 422)


@pytest.mark.asyncio
async def test_analyze_response_uses_snake_case_contract_fields() -> None:
    """
    Contract guard: the analysis service emits snake_case keys; the Next.js proxy
    maps them to camelCase per `packages/shared/src/types.ts::AnalysisResponse`.
    Any rename here must be coordinated with the shared TS types.
    """
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
                "grow_context": {"grow_id": "grow-1"},
            },
        )
    assert response.status_code == 200
    data = response.json()
    expected_keys = {
        "plant_id",
        "image_id",
        "overall_health_score",
        "summary",
        "findings",
        "compared_to_image_id",
        "comparison_summary",
        "analyzed_at",
        "model_version",
    }
    assert expected_keys.issubset(data.keys()), (
        f"Missing fields in response: {expected_keys - data.keys()}"
    )
    for finding in data["findings"]:
        assert {"category", "severity", "title", "description"}.issubset(finding.keys())
