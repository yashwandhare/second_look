"""Firestore access over the REST API.

This module talks to Firestore with the project id and the public client API
key, so the deployed container needs no private key file. Access is controlled
by Firestore security rules.

Configure with:
    FIREBASE_PROJECT_ID   the Firebase project id, for example my-app-12345
    FIREBASE_API_KEY      the web API key from the Firebase console

For an application that must bypass security rules, use the Firebase Admin SDK
with a service account instead, and keep that key in a secret store.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Firestore value tags used by the REST API. Each field is a one-key object.
_VALUE_TAGS = (
    "nullValue",
    "booleanValue",
    "integerValue",
    "doubleValue",
    "timestampValue",
    "stringValue",
    "bytesValue",
    "referenceValue",
    "geoPointValue",
    "arrayValue",
    "mapValue",
)


class FirestoreError(RuntimeError):
    """Raised when Firestore is unconfigured or returns an error."""


def is_configured() -> bool:
    """Return True when both required environment values are present."""
    return bool(os.getenv("FIREBASE_PROJECT_ID") and os.getenv("FIREBASE_API_KEY"))


def _base_url() -> str:
    """Return the documents endpoint for the configured project."""
    project = os.getenv("FIREBASE_PROJECT_ID", "")
    if not project:
        raise FirestoreError("FIREBASE_PROJECT_ID is not set")
    return (
        f"https://firestore.googleapis.com/v1/projects/{project}"
        "/databases/(default)/documents"
    )


def _to_firestore_value(value: Any) -> dict:
    """Convert a Python value into a Firestore REST value object."""
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, dict):
        return {"mapValue": {"fields": _to_fields(value)}}
    if isinstance(value, (list, tuple)):
        return {"arrayValue": {"values": [_to_firestore_value(v) for v in value]}}
    raise FirestoreError(f"Unsupported value type: {type(value).__name__}")


def _to_fields(document: dict[str, Any]) -> dict:
    """Convert a mapping into Firestore REST fields."""
    return {key: _to_firestore_value(value) for key, value in document.items()}


def _from_firestore_value(value: dict) -> Any:
    """Convert a Firestore REST value object back into a Python value."""
    for tag in _VALUE_TAGS:
        if tag in value:
            raw = value[tag]
            if tag == "integerValue":
                try:
                    return int(raw)
                except (TypeError, ValueError) as exc:
                    raise FirestoreError(
                        f"Malformed integerValue: {raw!r}"
                    ) from exc
            if tag == "mapValue":
                return _from_fields(raw.get("fields", {}))
            if tag == "arrayValue":
                return [_from_firestore_value(v) for v in raw.get("values", [])]
            return raw
    return None


def _from_fields(fields: dict) -> dict[str, Any]:
    """Convert Firestore REST fields back into a plain mapping."""
    return {key: _from_firestore_value(value) for key, value in fields.items()}


def _request(
    method: str, url: str, extra_params: dict | None = None, **kwargs: Any
) -> httpx.Response:
    """Send one request to Firestore, adding the API key and error handling."""
    params: dict[str, Any] = {"key": os.getenv("FIREBASE_API_KEY", "")}
    if extra_params:
        params.update(extra_params)
    try:
        response = httpx.request(method, url, params=params, timeout=10.0, **kwargs)
    except httpx.HTTPError as exc:
        raise FirestoreError(f"Firestore request failed: {exc}") from exc

    if response.status_code >= 400:
        detail = response.text[:300]
        raise FirestoreError(f"Firestore returned {response.status_code}: {detail}")
    return response


def set_document(collection: str, document_id: str, data: dict[str, Any]) -> dict:
    """Create or replace a document. Returns the stored fields."""
    url = f"{_base_url()}/{collection}/{document_id}"
    response = _request("PATCH", url, json={"fields": _to_fields(data)})
    return _from_fields(response.json().get("fields", {}))


def get_document(collection: str, document_id: str) -> dict | None:
    """Read one document, or None when it does not exist."""
    url = f"{_base_url()}/{collection}/{document_id}"
    api_key = os.getenv("FIREBASE_API_KEY", "")
    try:
        response = httpx.get(url, params={"key": api_key}, timeout=10.0)
    except httpx.HTTPError as exc:
        raise FirestoreError(f"Firestore request failed: {exc}") from exc

    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        raise FirestoreError(
            f"Firestore returned {response.status_code}: {response.text[:300]}"
        )
    return _from_fields(response.json().get("fields", {}))


def list_documents(collection: str, limit: int = 50) -> list[dict]:
    """Return up to `limit` documents from a collection."""
    url = f"{_base_url()}/{collection}"
    response = _request("GET", url, extra_params={"pageSize": limit})
    documents = response.json().get("documents", [])
    results = []
    for document in documents:
        item = _from_fields(document.get("fields", {}))
        item["_id"] = document.get("name", "").rsplit("/", 1)[-1]
        results.append(item)
    return results


def delete_document(collection: str, document_id: str) -> None:
    """Delete one document. Does nothing when it is already absent."""
    url = f"{_base_url()}/{collection}/{document_id}"
    _request("DELETE", url)
