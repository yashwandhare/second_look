"""API tests for the hackathon backend.

Run with:  .venv/bin/python -m pytest backend/tests -q
"""

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Make the repository root importable so `backend` resolves as a package.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.main import app  # noqa: E402


@pytest.fixture()
def client() -> TestClient:
    """Return a client bound to the application."""
    return TestClient(app)


def test_health_reports_ok(client: TestClient) -> None:
    """The health endpoint returns a success payload."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_root_serves_frontend(client: TestClient) -> None:
    """The root path serves the frontend page when it is present."""
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "<html" in response.text.lower()


def test_static_assets_are_served(client: TestClient) -> None:
    """The stylesheet is reachable under the static mount."""
    response = client.get("/static/css/style.css")
    assert response.status_code == 200
    assert "--canvas" in response.text


def test_unknown_route_returns_404(client: TestClient) -> None:
    """An unknown path fails cleanly instead of erroring."""
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404


def test_security_headers_are_present(client: TestClient) -> None:
    """Every response carries the baseline hardening headers."""
    headers = client.get("/api/health").headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "default-src 'self'" in headers["content-security-policy"]


def test_audit_returns_429_when_rate_limited(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A refused attempt reports 429 with a retry hint, without calling Gemini."""
    monkeypatch.setattr(
        "backend.routes.audit._audit_limiter.check", lambda _key: (False, 30)
    )
    response = client.post(
        "/api/audit",
        json={"decision": "A decision", "reasons": "Some reasons here.", "priorities": ""},
    )
    assert response.status_code == 429
    assert response.headers["retry-after"] == "30"
    assert "limit" in response.json()["detail"]


def test_silence_report_degrades_without_storage(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With storage unavailable the endpoint returns an empty report, not an error."""
    monkeypatch.setattr(
        "backend.routes.audit.firestore.is_configured", lambda: False
    )
    response = client.get("/api/silence-report")
    assert response.status_code == 200
    body = response.json()
    assert body["total_audits"] == 0
    assert body["findings"] == []
