"""Tests for the in-memory rate limiter."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services.ratelimit import RateLimiter  # noqa: E402


def test_allows_attempts_up_to_the_limit() -> None:
    """Every attempt inside the window is allowed until the limit is reached."""
    limiter = RateLimiter(limit=3, window_seconds=60)
    for _ in range(3):
        allowed, retry_after = limiter.check("client-a")
        assert allowed is True
        assert retry_after == 0


def test_blocks_the_attempt_after_the_limit() -> None:
    """The attempt beyond the limit is refused with a retry delay."""
    limiter = RateLimiter(limit=2, window_seconds=60)
    limiter.check("client-a")
    limiter.check("client-a")

    allowed, retry_after = limiter.check("client-a")
    assert allowed is False
    assert retry_after >= 1


def test_clients_do_not_share_a_budget() -> None:
    """One noisy client must not block another."""
    limiter = RateLimiter(limit=1, window_seconds=60)
    assert limiter.check("client-a")[0] is True
    assert limiter.check("client-a")[0] is False
    assert limiter.check("client-b")[0] is True


def test_window_resets_after_it_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    """Once the window passes, the client is allowed again."""
    clock = {"now": 1000.0}
    monkeypatch.setattr(
        "backend.services.ratelimit.time.monotonic", lambda: clock["now"]
    )

    limiter = RateLimiter(limit=1, window_seconds=60)
    assert limiter.check("client-a")[0] is True
    assert limiter.check("client-a")[0] is False

    clock["now"] += 61
    assert limiter.check("client-a")[0] is True


def test_expired_windows_are_pruned(monkeypatch: pytest.MonkeyPatch) -> None:
    """The tracking table does not grow without bound."""
    clock = {"now": 1000.0}
    monkeypatch.setattr(
        "backend.services.ratelimit.time.monotonic", lambda: clock["now"]
    )
    monkeypatch.setattr("backend.services.ratelimit.MAX_TRACKED_CLIENTS", 2)

    limiter = RateLimiter(limit=1, window_seconds=30)
    limiter.check("a")
    limiter.check("b")

    clock["now"] += 31
    limiter.check("c")  # triggers the prune

    assert len(limiter._windows) < 3


@pytest.mark.parametrize(("limit", "window"), [(0, 60), (5, 0), (-1, 60)])
def test_invalid_configuration_is_rejected(limit: int, window: int) -> None:
    """A nonsensical limiter fails loudly rather than silently allowing all."""
    with pytest.raises(ValueError):
        RateLimiter(limit=limit, window_seconds=window)
