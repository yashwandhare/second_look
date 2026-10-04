"""HTTP routes for the reasoning auditor."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request

from backend.models.schemas import (
    AuditRequest,
    AuditResult,
    SilenceFinding,
    SilenceReport,
    StoredAuditSummary,
)
from backend.services import firestore
from backend.services.audit import run_audit
from backend.services.ratelimit import RateLimiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["audit"])

COLLECTION = "audits"

# Every audit spends Gemini quota, so one caller must not be able to drain it
# during a live demonstration.
AUDIT_LIMIT = 8
AUDIT_WINDOW_SECONDS = 60
_audit_limiter = RateLimiter(limit=AUDIT_LIMIT, window_seconds=AUDIT_WINDOW_SECONDS)


def _as_int(value: object) -> int:
    """Coerce a stored value to int, falling back to zero.

    Firestore returns whatever was written, so a malformed or missing count
    must not break the listing.
    """
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


@router.post("/audit", response_model=AuditResult)
async def create_audit(request: AuditRequest, http_request: Request) -> AuditResult:
    """Audit the user's reasoning and return the findings.

    The audit is stored when Firestore is configured. Storage is optional: a
    failed save never costs the user their analysis.
    """
    client = http_request.client.host if http_request.client else "unknown"
    allowed, retry_after = _audit_limiter.check(client)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=(
                f"That is the limit of {AUDIT_LIMIT} audits per minute. "
                f"Wait about {retry_after} seconds and try again."
            ),
            headers={"Retry-After": str(retry_after)},
        )

    try:
        result = run_audit(request)
    except RuntimeError as exc:
        logger.error("audit failed: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if firestore.is_configured():
        audit_id = uuid.uuid4().hex[:12]
        try:
            firestore.set_document(
                COLLECTION,
                audit_id,
                {
                    "audit_id": audit_id,
                    "created_at": datetime.now(UTC).isoformat(),
                    "decision": request.decision,
                    "leaning": request.leaning,
                    "reasons": request.reasons,
                    "priorities": request.priorities,
                    "restatement": result.restatement,
                    "blind_spot_count": len(result.blind_spots),
                    "assumption_count": len(result.assumptions),
                    "silent_dimensions": [s.label for s in result.salience.silent],
                    "emphasised_dimensions": [s.label for s in result.salience.emphasised],
                },
            )
        except firestore.FirestoreError as exc:
            logger.warning("could not save audit: %s", exc)

    return result


@router.get("/decisions", response_model=list[StoredAuditSummary])
async def list_decisions(limit: int = 20) -> list[StoredAuditSummary]:
    """Return recent audits, newest first."""
    if not firestore.is_configured():
        return []

    try:
        records = firestore.list_documents(COLLECTION, limit=limit)
    except firestore.FirestoreError as exc:
        logger.warning("could not list audits: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    records.sort(key=lambda r: str(r.get("created_at", "")), reverse=True)

    return [
        StoredAuditSummary(
            audit_id=str(r.get("_id") or r.get("audit_id", "")),
            created_at=str(r.get("created_at", "")),
            decision=str(r.get("decision", "")),
            restatement=str(r.get("restatement", "")),
            blind_spot_count=_as_int(r.get("blind_spot_count")),
            assumption_count=_as_int(r.get("assumption_count")),
            reasons=str(r.get("reasons", "")),
            priorities=str(r.get("priorities", "")),
            leaning=str(r.get("leaning", "")),
        )
        for r in records
    ]


@router.get("/silence-report", response_model=SilenceReport)
async def get_silence_report() -> SilenceReport:
    """Aggregate habitual blind spots across all stored decisions.

    Finds dimensions that are repeatedly omitted across multiple decisions,
    turning isolated audits into a personal metacognitive pattern.
    """
    if not firestore.is_configured():
        return SilenceReport(total_audits=0, findings=[], note="Storage not configured.")

    try:
        records = firestore.list_documents(COLLECTION, limit=50)
    except firestore.FirestoreError as exc:
        logger.warning("could not compile silence report: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    total = len(records)
    if total < 2:
        return SilenceReport(
            total_audits=total,
            findings=[],
            note="Audit at least two decisions to surface your cross-decision habits.",
        )

    silence_counts: dict[str, int] = {}
    for r in records:
        for dim in r.get("silent_dimensions", []):
            if isinstance(dim, str):
                silence_counts[dim] = silence_counts.get(dim, 0) + 1

    findings = [
        SilenceFinding(label=dim, missed_in=count, total_audits=total)
        for dim, count in silence_counts.items()
        if (count / total) >= 0.3
    ]
    findings.sort(key=lambda f: f.missed_in, reverse=True)

    if findings:
        top = findings[0]
        try:
            pct = int(top.miss_rate * 100)
        except (TypeError, ValueError, ZeroDivisionError):
            pct = 0
        note = (
            f"Across your past {total} decisions, you habitually omitted '{top.label}' "
            f"in {top.missed_in} of them ({pct}%)."
        )
    else:
        note = f"Across your past {total} decisions, your attention has been balanced."

    return SilenceReport(total_audits=total, findings=findings, note=note)
