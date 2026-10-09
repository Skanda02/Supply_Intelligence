"""Fair-Share Allocation Engine: single-medicine triage across hospitals.

Formulation (documented as an LP for future OR-Tools use)::

    maximize    sum_h  priority_h * allocated_h
    subject to  0 <= allocated_h <= min(need_h, transport_cap)   for every hospital h
                sum_h allocated_h <= pool_units

For a single medicine with independent per-hospital caps, fulfilling hospitals
in descending priority order attains the optimum of this LP, so the engine
below is exact for the stated objective while remaining fully explainable.
(OR-Tools' native solver cannot load in locked-down environments — its DLL is
blocked by the OS application-control policy — hence this dependency-free
solver. The response always names the solver used.)

Priority (0-100) blends, in order of clinical urgency:
  days until stockout (30) > medicine criticality (30) > recent emergency
  cases (20) > patient load (15), minus a mitigation when approved
  same-category alternatives already cover the hospital (-8).

Hard guarantees (asserted by tests):
  * sum(allocated) <= pool_units — never more than available.
  * contributors keep safety_days of cover — pool only from surplus above it.
  * hospitals with an unmet need never contribute (no churn).
  * per-hospital transport cap respected.
"""

import math
from dataclasses import dataclass, field
from datetime import timedelta

from sqlalchemy.orm import Session

from app.models.entities import DemandHistory, Hospital, Medicine
from app.services.inventory_service import get_current_operational_date, list_hospital_inventory

SOLVER_NAME = "priority-triage-v1"
CONTRIBUTION_RULE = (
    "Only hospitals with no deficit contribute, and only the surplus above "
    "safety_days of cover. Hospitals with unmet need keep all their stock."
)

CRITICALITY_WEIGHT = {"CRITICAL": 30.0, "HIGH": 22.0, "MEDIUM": 12.0, "LOW": 4.0}

RECENT_WINDOW_DAYS = 14


@dataclass
class HospitalNeed:
    hospital_id: str
    hospital_name: str
    usable: float = 0.0
    daily_demand: float = 0.0
    days_until_stockout: float | None = None
    emergency_recent: int = 0
    patient_recent: int = 0
    criticality: str = "LOW"
    alt_cover_days: float = 0.0
    bed_capacity: int = 0
    # Filled during solving:
    need_units: int = 0
    priority_score: float = 0.0
    priority_breakdown: dict = field(default_factory=dict)


def priority_for_need(need: HospitalNeed) -> tuple[float, dict]:
    """Priority score 0-100 with a per-factor breakdown (sums to the score)."""
    if need.need_units <= 0:
        return 0.0, {"stockout": 0.0, "criticality": 0.0, "emergency": 0.0, "patients": 0.0, "alternatives": 0.0}

    dus = need.days_until_stockout if need.days_until_stockout is not None else 999.0
    if dus <= 3:
        stockout = 30.0
    elif dus <= 7:
        stockout = 22.0
    elif dus <= 14:
        stockout = 14.0
    elif dus <= 30:
        stockout = 8.0
    else:
        stockout = 0.0

    criticality = CRITICALITY_WEIGHT.get(str(need.criticality).upper(), 4.0)
    emergency = min(20.0, need.emergency_recent / 10.0)
    patients = min(15.0, (need.patient_recent / RECENT_WINDOW_DAYS) / 20.0)
    alternatives = -8.0 if need.alt_cover_days >= 3.0 else 0.0

    score = max(0.0, min(100.0, stockout + criticality + emergency + patients + alternatives))
    breakdown = {
        "stockout": round(stockout, 1),
        "criticality": round(criticality, 1),
        "emergency": round(emergency, 1),
        "patients": round(patients, 1),
        "alternatives": round(alternatives, 1),
    }
    return round(score, 1), breakdown


def fair_share_allocate(
    needs: list[HospitalNeed],
    target_cover_days: float,
    safety_days: float,
    max_transport_units: int,
) -> dict:
    """Allocate a fixed pool across hospitals in priority order.

    Returns a plain-dict result (totals, contributions, per-hospital rows).
    """
    # Need + priority per hospital.
    for need in needs:
        demand = max(0.0, need.daily_demand)
        need.need_units = max(0, int(round(target_cover_days * demand - need.usable)))
        need.priority_score, need.priority_breakdown = priority_for_need(need)

    # Pool: surplus above safety stock, contributors only (no deficit).
    contributions: list[dict] = []
    pool = 0
    for need in needs:
        if need.need_units > 0:
            continue
        surplus = int(math.floor(max(0.0, need.usable - safety_days * max(0.0, need.daily_demand))))
        if surplus > 0:
            pool += surplus
            contributions.append(
                {"hospital_id": need.hospital_id, "hospital_name": need.hospital_name, "contributed_units": surplus}
            )
    contributed_by = {c["hospital_id"]: c["contributed_units"] for c in contributions}

    # Triage order: score desc, soonest stockout first, stable id last.
    ordered = sorted(
        needs,
        key=lambda n: (-n.priority_score, n.days_until_stockout if n.days_until_stockout is not None else 999.0, n.hospital_id),
    )

    allocations: list[dict] = []
    remaining = pool
    for rank, need in enumerate(ordered, start=1):
        allocated = 0
        if need.need_units > 0 and remaining > 0:
            allocated = min(need.need_units, remaining, max_transport_units)
        remaining -= allocated
        unmet = need.need_units - allocated
        allocated = int(allocated)

        if need.need_units <= 0:
            explanation = (
                f"Rank #{rank}: no deficit for {target_cover_days:g}-day cover "
                f"(usable {need.usable:g} covers need). "
                + (
                    f"Retained as contributor ({contributed_by.get(need.hospital_id, 0)} units to the pool, safety stock protected)."
                    if need.hospital_id in contributed_by
                    else "No surplus above safety stock — nothing contributed."
                )
            )
        elif unmet == 0:
            explanation = (
                f"Rank #{rank} of {len(ordered)} with priority {need.priority_score} "
                f"(stockout {need.priority_breakdown['stockout']} + criticality "
                f"{need.priority_breakdown['criticality']} + emergency {need.priority_breakdown['emergency']} "
                f"+ patients {need.priority_breakdown['patients']} "
                f"{need.priority_breakdown['alternatives']:+g} alternatives). "
                f"Need was {need.need_units} units for {target_cover_days:g}-day cover "
                f"(demand {need.daily_demand:g}/day, usable {need.usable:g}); "
                f"allocated {allocated} — need fully covered."
            )
        else:
            explanation = (
                f"Rank #{rank} of {len(ordered)} with priority {need.priority_score}. "
                f"Need was {need.need_units} units for {target_cover_days:g}-day cover; "
                f"allocated {allocated} (transport cap {max_transport_units}, pool remainder). "
                f"{unmet} units unmet — pool exhausted by higher-priority hospitals."
            )

        allocations.append(
            {
                "rank": rank,
                "hospital_id": need.hospital_id,
                "hospital_name": need.hospital_name,
                "priority_score": need.priority_score,
                "priority_breakdown": need.priority_breakdown,
                "need_units": need.need_units,
                "allocated_units": allocated,
                "unmet_units": unmet,
                "fully_covered": unmet == 0,
                "contributor": need.hospital_id in contributed_by,
                "contributed_units": contributed_by.get(need.hospital_id, 0),
                "explanation": explanation,
            }
        )

    total_need = sum(n.need_units for n in needs)
    total_allocated = sum(a["allocated_units"] for a in allocations)
    total_unmet = sum(a["unmet_units"] for a in allocations)
    all_met = total_unmet == 0
    summary = (
        f"Allocated {total_allocated} of {total_need} needed units across "
        f"{sum(1 for n in needs if n.need_units > 0)} hospitals from a pool of {pool}. "
        + (
            "All needs met — every deficit is fully covered by this plan."
            if all_met and total_need > 0
            else ("No deficits found — nothing to allocate." if total_need == 0 else f"{total_unmet} units unmet — the pool is exhausted.")
        )
    )
    return {
        "pool_units": pool,
        "total_need_units": total_need,
        "total_allocated_units": total_allocated,
        "total_unmet_units": total_unmet,
        "all_needs_met": all_met,
        "solver": SOLVER_NAME,
        "contribution_rule": CONTRIBUTION_RULE,
        "summary": summary,
        "contributions": contributions,
        "allocations": allocations,
    }


def collect_needs(
    db: Session,
    medicine_id: str,
    target_cover_days: float,
    boosts: dict[str, float] | None = None,
) -> tuple[list[HospitalNeed], dict]:
    """Gather per-hospital need signals for a medicine from live data.

    boosts maps hospital_id -> demand uplift fraction (e.g. 0.5 = +50%)
    for the Simulate Emergency scenario.
    """
    boosts = boosts or {}
    medicine = db.query(Medicine).filter(Medicine.id == medicine_id).first()
    if not medicine:
        raise ValueError(f"Unknown medicine {medicine_id}")

    today = get_current_operational_date()
    window_start = today - timedelta(days=RECENT_WINDOW_DAYS)
    hospitals = db.query(Hospital).order_by(Hospital.id).all()

    needs: list[HospitalNeed] = []
    for hosp in hospitals:
        details = list_hospital_inventory(db, hosp.id)
        mine = next((d for d in details if d.medicine_id == medicine_id), None)

        usable = float(mine.usable_inventory) if mine else 0.0
        daily = float(mine.expected_daily_demand) if mine else 0.0
        dus = float(mine.days_until_stockout) if mine and mine.days_until_stockout is not None else None

        recent = (
            db.query(DemandHistory)
            .filter(
                DemandHistory.hospital_id == hosp.id,
                DemandHistory.medicine_id == medicine_id,
                DemandHistory.date >= window_start,
            )
            .all()
        )
        emergency_recent = sum(r.emergency_cases or 0 for r in recent)
        patient_recent = sum(r.patient_load or 0 for r in recent)
        if daily <= 0 and recent:
            daily = sum(r.quantity_consumed or 0 for r in recent) / RECENT_WINDOW_DAYS

        uplift = boosts.get(hosp.id, 0.0)
        if uplift:
            daily = daily * (1.0 + uplift)
            emergency_recent = int(round(emergency_recent * (1.0 + uplift)))

        alt_usable = sum(
            float(d.usable_inventory)
            for d in details
            if d.medicine_id != medicine_id and d.category == medicine.category
        )
        alt_cover = alt_usable / daily if daily > 0 else 0.0

        needs.append(
            HospitalNeed(
                hospital_id=hosp.id,
                hospital_name=hosp.name,
                usable=usable,
                daily_demand=daily,
                days_until_stockout=dus,
                emergency_recent=emergency_recent,
                patient_recent=patient_recent,
                criticality=medicine.criticality_level,
                alt_cover_days=alt_cover,
                bed_capacity=hosp.bed_capacity or 0,
            )
        )

    meta = {"medicine_id": medicine.id, "medicine_name": medicine.name, "unit": medicine.unit}
    return needs, meta
