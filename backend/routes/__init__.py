"""Hackathon backend — API routes."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1", tags=["hackathon"])


@router.get("/status")
async def status():
    """Return service status."""
    return {"status": "ok"}
