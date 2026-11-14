import pytest

from app import nasa_client


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    """Force the deterministic fallback climate + a no-op cache so tests never hit the network."""

    async def _boom(*_a, **_k):
        import httpx

        raise httpx.ConnectTimeout("offline test")

    async def _none(*_a, **_k):
        return None

    monkeypatch.setattr(nasa_client, "_request_power", _boom)
    monkeypatch.setattr(nasa_client.cache, "get_json", _none)
    monkeypatch.setattr(nasa_client.cache, "set_json", _none)
    monkeypatch.setattr(nasa_client.cache, "ping", _none)
