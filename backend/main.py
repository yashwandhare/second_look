"""
FastAPI backend entry point for PromptWars hackathon skeleton.
Adapt to the problem statement on event day.
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

try:
    import uvicorn
except ImportError:  # uvicorn is only needed to run the dev server directly.
    uvicorn = None

try:  # Load a local .env when present; deployments inject real variables.
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # dotenv is optional at runtime.
    pass

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.routes.audit import router as audit_router
from backend.services import firestore

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_PORT = 8000


def _server_port() -> int:
    """Read PORT, falling back to the default when it is missing or invalid."""
    raw = os.getenv("PORT")
    if not raw:
        return DEFAULT_PORT
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid PORT %r; using %d", raw, DEFAULT_PORT)
        return DEFAULT_PORT


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Log start and stop so container output shows the process lifecycle."""
    logger.info(
        "Second Look starting | gemini=%s firestore=%s",
        "ready" if os.getenv("GEMINI_API_KEY", "").strip() else "missing",
        "ready" if firestore.is_configured() else "missing",
    )
    yield
    logger.info("Second Look stopping")


def create_app() -> FastAPI:
    """Build the FastAPI application."""
    app = FastAPI(
        title="Second Look",
        description=(
            "Audits how a person reasons about a decision and surfaces the "
            "assumptions, omissions and contradictions in their thinking. "
            "It never recommends an option."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )

    # The frontend is served from this same origin, so CORS is unnecessary by
    # default. Add explicit origins through CORS_ORIGINS when the frontend is
    # hosted separately. A wildcard is never combined with credentials.
    cors_origins = [o for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # Baseline security headers. The frontend uses only external scripts and
    # styles, so a strict Content-Security-Policy needs no inline exceptions.
    @app.middleware("http")
    async def security_headers(request, call_next):
        """Attach hardening headers, and stop stale asset caching."""
        response = await call_next(request)
        response.headers.update(
            {
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "Referrer-Policy": "strict-origin-when-cross-origin",
                "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
                "Content-Security-Policy": (
                    "default-src 'self'; img-src 'self' data:; style-src 'self'; "
                    # The host injects its own analytics beacon; allowing that
                    # one origin keeps the console clean without opening up
                    # script-src generally.
                    "script-src 'self' https://static.cloudflareinsights.com; "
                    "connect-src 'self' https://cloudflareinsights.com; "
                    "base-uri 'self'; form-action 'self'"
                ),
            }
        )
        # The CDN otherwise caches css/js for hours, so a redeploy can serve a
        # stale interface. Revalidate on every request instead.
        if request.url.path.startswith("/static/"):
            response.headers.update(
                {"Cache-Control": "no-cache, must-revalidate"}
            )
        return response

    @app.get("/api/health")
    async def health() -> dict:
        """Report service health and integration status."""
        return {
            "status": "ok",
            "service": "second-look",
            "google_services": {
                "gemini": (
                    "configured"
                    if os.getenv("GEMINI_API_KEY", "").strip()
                    else "unconfigured"
                ),
                "model": os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
                "firestore": (
                    "configured" if firestore.is_configured() else "unconfigured"
                ),
            },
        }

    # Serve the frontend from the same origin as the API. One deploy and one
    # URL then cover both, so production needs no CORS configuration.
    app.include_router(audit_router)

    frontend_dir = Path(__file__).resolve().parents[1] / "frontend"
    if not frontend_dir.is_dir():
        # Deployed without the frontend, for example an API-only environment.
        return app

    app.mount(
        "/static",
        StaticFiles(directory=str(frontend_dir)),
        name="static",
    )

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        """Serve the frontend entry page."""
        return FileResponse(frontend_dir / "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    if uvicorn is None:
        raise SystemExit("uvicorn is not installed: pip install -r backend/requirements.txt")

    # The container needs all interfaces; use HOST to change the bind address.
    uvicorn.run(
        "backend.main:app",
        host=os.getenv("HOST", "0.0.0.0"),  # noqa: S104 - container bind
        port=_server_port(),
    )