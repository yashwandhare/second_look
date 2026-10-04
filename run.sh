#!/usr/bin/env bash
#
# Start Second Look locally and open it in the browser.
#
#   make run              # 127.0.0.1:8000, opens your browser
#   PORT=9000 make run    # a different port
#   HOST=0.0.0.0 make run # reachable from another device on the network
#
# Ctrl+C stops the server.

set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PY=".venv/bin/python"
URL="http://${HOST}:${PORT}"

say() { printf '  %s\n' "$*"; }
die() { printf '\n  %s\n\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

if [[ ! -x "$PY" ]]; then
  printf '\n  No virtual environment yet.\n\n'
  say "Run: make install"
  printf '\n'
  exit 1
fi

if [[ ! -f .env ]]; then
  printf '\n  No .env file found.\n\n'
  say "Run: cp .env.example .env"
  say "Then fill in GEMINI_API_KEY, FIREBASE_PROJECT_ID and FIREBASE_API_KEY."
  printf '\n'
  exit 1
fi

missing=()
for key in GEMINI_API_KEY FIREBASE_PROJECT_ID FIREBASE_API_KEY; do
  # A key counts as set when it has a non-empty value on its own line.
  if ! grep -qE "^${key}=.+" .env; then
    missing+=("$key")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf '\n  These are empty in .env:\n\n'
  for key in "${missing[@]}"; do say "$key"; done
  printf '\n'
  exit 1
fi

# ---------------------------------------------------------------------------
# Port
# ---------------------------------------------------------------------------

if curl -sf "${URL}/api/health" >/dev/null 2>&1; then
  printf '\n  Port %s already has a server running.\n\n' "$PORT"
  say "Opening it instead. Stop that one first if it is an old build."
  printf '\n'
  xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 || true
  exit 0
fi

if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  die "Port ${PORT} is in use by something else. Try: PORT=8001 make run"
fi

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

printf '\n  Second Look\n'
printf '  %s\n\n' "$(printf '%.0s-' {1..40})"
say "Starting on ${URL}"
say "Press Ctrl+C to stop"
printf '\n'

"$PY" -m uvicorn backend.main:app --host "$HOST" --port "$PORT" --log-level warning &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  wait "$SERVER_PID" 2>/dev/null || true
  printf '\n  Stopped.\n\n'
}
trap cleanup EXIT INT TERM

# Wait for the app to answer before opening a browser on it.
ready=0
for _ in $(seq 1 60); do
  if curl -sf "${URL}/api/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    die "The server exited during startup. Scroll up for the error."
  fi
  sleep 0.25
done

if (( ready == 0 )); then
  die "The server did not answer within 15 seconds."
fi

printf '  Ready.\n\n'
say "Try these three examples:"
say "  1.  Adopting a dog          -> an assumption you never tested"
say "  2.  Moving for a partner    -> a contradiction in your reasoning"
say "  3.  Renting or buying       -> a flawed comparison"
printf '\n'

xdg-open "$URL" >/dev/null 2>&1 || open "$URL" >/dev/null 2>&1 || true

wait "$SERVER_PID"
