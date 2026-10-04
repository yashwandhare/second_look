"""In-memory rate limiting.

A fixed-window counter per client. Enough to stop one caller from exhausting
the Gemini quota during a live demonstration. State lives in the process, which
is correct for a single-container deployment and would need Redis behind more
than one replica.
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass

# Beyond this many tracked clients the table is pruned, so a flood of distinct
# addresses cannot grow memory without bound.
MAX_TRACKED_CLIENTS = 2048


@dataclass
class _Window:
    """One client's current window."""

    count: int = 0
    reset_at: float = 0.0


class RateLimiter:
    """Allow at most `limit` actions per `window_seconds` per key."""

    def __init__(self, limit: int, window_seconds: int) -> None:
        if limit < 1 or window_seconds < 1:
            raise ValueError("limit and window_seconds must be positive")
        self.limit = limit
        self.window_seconds = window_seconds
        self._windows: dict[str, _Window] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> tuple[bool, int]:
        """Record an attempt.

        Returns:
            A pair of (allowed, retry_after_seconds). retry_after_seconds is 0
            when the attempt is allowed.
        """
        now = time.monotonic()
        with self._lock:
            if len(self._windows) >= MAX_TRACKED_CLIENTS:
                self._prune(now)

            window = self._windows.get(key)
            if window is None or now >= window.reset_at:
                window = _Window(count=0, reset_at=now + self.window_seconds)
                self._windows[key] = window

            if window.count >= self.limit:
                # Round the wait up: telling a caller to retry too early is
                # worse than telling them slightly late.
                try:
                    retry_after = max(1, math.ceil(window.reset_at - now))
                except (TypeError, ValueError, OverflowError):
                    retry_after = self.window_seconds
                return False, retry_after

            window.count += 1
            return True, 0

    def _prune(self, now: float) -> None:
        """Drop expired windows. Called while holding the lock."""
        for key in [k for k, w in self._windows.items() if now >= w.reset_at]:
            del self._windows[key]
