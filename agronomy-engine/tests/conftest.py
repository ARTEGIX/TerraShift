import pytest

from app import nasa_fusion, soil_client


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    """Force deterministic 36-month fallback climate & no-op Redis cache during tests."""

    async def _boom(*_a, **_k):
        import httpx

        raise httpx.ConnectTimeout("offline test")

    async def _none(*_a, **_k):
        return None

    monkeypatch.setattr(nasa_fusion, "_fetch_power_raw", _boom)
    monkeypatch.setattr(soil_client, "_fetch_soilgrids_raw", _boom)
    monkeypatch.setattr(nasa_fusion.cache, "get_json", _none)
    monkeypatch.setattr(nasa_fusion.cache, "set_json", _none)
    monkeypatch.setattr(nasa_fusion.cache, "ping", _none)
