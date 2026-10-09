"""Fair-share allocation endpoints (single-medicine triage + approval reviews).

Auth note: these stay open (no Bearer requirement) because the frontend API
clients do not attach JWTs yet. Once token attachment lands, protect GETs
with ``Depends(require_read)`` and the POST runs/reviews with
``Depends(require_admin)`` per project.md A4 (runs are ADMIN-only).
Reviewer identity is captured explicitly in the approval payload meanwhile.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.allocation import (
    AllocationResult,
    ApprovalRecord,
    CreateRunRequest,
    FairShareRequest,
    FairShareResponse,
    HospitalDelta,
    ReviewRequest,
    RunDetail,
    RunSummary,
)
from app.services import allocation_store
from app.services.allocation_service import collect_needs, fair_share_allocate

router = APIRouter()


def _build_result(request: FairShareRequest, boosts: dict[str, float], db: Session) -> AllocationResult:
    needs, meta = collect_needs(db, request.medicine_id, request.target_cover_days, boosts)
    outcome = fair_share_allocate(needs, request.target_cover_days, request.safety_days, request.max_transport_units)
    return AllocationResult(
        medicine_id=meta["medicine_id"],
        medicine_name=meta["medicine_name"],
        unit=meta["unit"],
        **outcome,
    )


@router.post("/fair-share", response_model=FairShareResponse, summary="Compute fair-share allocation")
def compute_fair_share(request: FairShareRequest, db: Session = Depends(get_db)):
    try:
        baseline = _build_result(request, {}, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    scenario: AllocationResult | None = None
    delta: list[HospitalDelta] | None = None
    if request.emergency_scenario:
        uplift = request.emergency_scenario.demand_uplift_pct / 100.0
        boosts = {request.emergency_scenario.hospital_id: uplift}
        try:
            scenario = _build_result(request, boosts, db)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        before = {a.hospital_id: a for a in baseline.allocations}
        delta = []
        for after in scenario.allocations:
            b = before.get(after.hospital_id)
            if b is None:
                continue
            delta.append(
                HospitalDelta(
                    hospital_id=after.hospital_id,
                    hospital_name=after.hospital_name,
                    priority_before=b.priority_score,
                    priority_after=after.priority_score,
                    allocated_before=b.allocated_units,
                    allocated_after=after.allocated_units,
                    delta_units=after.allocated_units - b.allocated_units,
                )
            )
        delta.sort(key=lambda d: d.delta_units, reverse=True)

    return FairShareResponse(
        medicine_id=baseline.medicine_id,
        medicine_name=baseline.medicine_name,
        baseline=baseline,
        scenario=scenario,
        scenario_delta=delta,
        simulated=scenario is not None,
    )


@router.post("/runs", response_model=RunSummary, summary="Submit an allocation for approval")
def submit_run(body: CreateRunRequest, db: Session = Depends(get_db)):
    run = allocation_store.create_run(
        db,
        medicine_id=body.result.medicine_id,
        medicine_name=body.result.medicine_name,
        params=body.request.model_dump(),
        result=body.result.model_dump(),
        created_by=body.created_by,
    )
    return RunSummary(
        run_id=run.id,
        medicine_id=run.medicine_id,
        medicine_name=run.medicine_name,
        status=run.status,
        created_at=run.created_at.isoformat() if run.created_at else None,
    )


@router.post("/runs/{run_id}/review", response_model=ApprovalRecord, summary="Approve or reject an allocation run")
def review_run(run_id: str, body: ReviewRequest, db: Session = Depends(get_db)):
    try:
        approval = allocation_store.review_run(db, run_id, body.decision, body.reviewer, body.note)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ApprovalRecord(
        id=approval.id,
        run_id=approval.run_id,
        decision=approval.decision,
        reviewer=approval.reviewer,
        note=approval.note,
        created_at=approval.created_at.isoformat() if approval.created_at else None,
    )


@router.get("/runs/{run_id}", response_model=RunDetail, summary="Allocation run with reviews")
def get_run(run_id: str, db: Session = Depends(get_db)):
    detail = allocation_store.get_run_detail(db, run_id)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Unknown allocation run {run_id}")
    approvals = [ApprovalRecord(**a) for a in detail["approvals"]]
    return RunDetail(
        run_id=detail["run_id"],
        medicine_id=detail["medicine_id"],
        medicine_name=detail["medicine_name"],
        status=detail["status"],
        params=detail["params"],
        result=detail["result"],
        created_at=detail["created_at"],
        approvals=approvals,
    )
