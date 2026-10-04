"""Tests for the Firestore REST helpers.

These tests do not touch the network. They cover the value conversion, which is
where a silent type bug would cause real data loss.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services import firestore  # noqa: E402


def test_is_configured_false_without_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unconfigured environment reports itself as such."""
    monkeypatch.delenv("FIREBASE_PROJECT_ID", raising=False)
    monkeypatch.delenv("FIREBASE_API_KEY", raising=False)
    assert firestore.is_configured() is False


def test_is_configured_true_with_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both environment values together mean configured."""
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "demo-project")
    monkeypatch.setenv("FIREBASE_API_KEY", "demo-key")
    assert firestore.is_configured() is True


def test_base_url_requires_project(monkeypatch: pytest.MonkeyPatch) -> None:
    """A missing project id raises instead of building a broken URL."""
    monkeypatch.delenv("FIREBASE_PROJECT_ID", raising=False)
    with pytest.raises(firestore.FirestoreError):
        firestore._base_url()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, {"nullValue": None}),
        (True, {"booleanValue": True}),
        (False, {"booleanValue": False}),
        (7, {"integerValue": "7"}),
        (1.5, {"doubleValue": 1.5}),
        ("text", {"stringValue": "text"}),
    ],
)
def test_value_encoding(value: object, expected: dict) -> None:
    """Scalars encode to the Firestore REST shape."""
    assert firestore._to_firestore_value(value) == expected


def test_nested_structures_round_trip() -> None:
    """A nested document survives encode then decode unchanged."""
    original = {
        "flag": True,
        "count": 42,
        "ratio": 2.5,
        "label": "hello",
        "missing": None,
        "nested": {"inner": 1},
        "items": [1, 2, 3],
    }
    encoded = firestore._to_fields(original)
    assert firestore._from_fields(encoded) == original


def test_malformed_integer_is_rejected() -> None:
    """A non-numeric integerValue raises instead of returning wrong data."""
    with pytest.raises(firestore.FirestoreError):
        firestore._from_firestore_value({"integerValue": "not-a-number"})


def test_unsupported_type_is_rejected() -> None:
    """An unsupported Python type raises a clear error."""
    with pytest.raises(firestore.FirestoreError):
        firestore._to_firestore_value(object())


def test_list_documents_sends_page_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pagination is merged with the API key, not passed twice."""
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "demo-project")
    monkeypatch.setenv("FIREBASE_API_KEY", "demo-key")

    captured: dict = {}

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json() -> dict:
            return {"documents": []}

    def fake_request(method, url, **kwargs):  # noqa: ANN001, ANN202
        captured["method"] = method
        captured["params"] = kwargs.get("params")
        return FakeResponse()

    monkeypatch.setattr(firestore.httpx, "request", fake_request)
    firestore.list_documents("things", limit=5)

    assert captured["params"]["pageSize"] == 5
    assert captured["params"]["key"] == "demo-key"
