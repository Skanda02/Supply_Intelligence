"""Persistence for allocation runs and their approval reviews.

Tables are created lazily and idempotently so existing deployments only gain
the two new tables (see also supabase/migrations/*_allocation_approvals.sql
for hosted Supabase parity).
"""

import json
import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.database import Base, engine
from app.models.entities import AllocationApproval, AllocationRun

_VALID_DECISIONS = ("APPROVED", "REJECTED")


def ensure_allocation_tables() -> None:
    Base.metadata.create_all(
        bind=engine, tables=[AllocationRun.__table__, AllocationApproval.__table__]
    )


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def create_run(
    db: Session,
    medicine_id: str,
    medicine_name: str,
    params: dict,
    result: dict,
    created_by: str | None = None,
) -> AllocationRun:
    ensure_allocation_tables()
    run = AllocationRun(
        id=str(uuid.uuid4()),
        medicine_id=medicine_id,
        medicine_name=medicine_name,
        params_json=json.dumps(params),
        result_json=json.dumps(result),
        status="PENDING",
        created_by=created_by,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def review_run(db: Session, run_id: str, decision: str, reviewer: str, note: str | None = None) -> AllocationApproval:
    ensure_allocation_tables()
    if decision not in _VALID_DECISIONS:
        raise ValueError(f"decision must be one of {_VALID_DECISIONS}")
    if not reviewer or not reviewer.strip():
        raise ValueError("reviewer is required")
    run = db.query(AllocationRun).filter(AllocationRun.id == run_id).first()
    if not run:
        raise LookupError(f"Unknown allocation run {run_id}")
    approval = AllocationApproval(
        id=str(uuid.uuid4()),
        run_id=run_id,
        decision=decision,
        reviewer=reviewer.strip(),
        note=note,
    )
    run.status = decision
    db.add(approval)
    db.commit()
    db.refresh(approval)
    return approval


def get_run_detail(db: Session, run_id: str) -> dict | None:
    ensure_allocation_tables()
    run = db.query(AllocationRun).filter(AllocationRun.id == run_id).first()
    if not run:
        return None
    approvals = (
        db.query(AllocationApproval)
        .filter(AllocationApproval.run_id == run_id)
        .order_by(AllocationApproval.created_at.asc())
        .all()
    )
    return {
        "run_id": run.id,
        "medicine_id": run.medicine_id,
        "medicine_name": run.medicine_name,
        "status": run.status,
        "params": json.loads(run.params_json or "{}"),
        "result": json.loads(run.result_json or "{}"),
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "approvals": [
            {
                "id": a.id,
                "run_id": a.run_id,
                "decision": a.decision,
                "reviewer": a.reviewer,
                "note": a.note,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in approvals
        ],
    }
