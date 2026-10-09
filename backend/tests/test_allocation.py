"""Unit + API tests for the Fair-Share Allocation Engine."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.allocation_service import HospitalNeed, fair_share_allocate


def _need(hospital_id: str, usable: float, demand: float, dus: float | None, **kw) -> HospitalNeed:
    base = dict(
        hospital_name=hospital_id,
        usable=usable,
        daily_demand=demand,
        days_until_stockout=dus,
        emergency_recent=kw.pop("emergency_recent", 0),
        patient_recent=kw.pop("patient_recent", 0),
        criticality=kw.pop("criticality", "HIGH"),
        alt_cover_days=kw.pop("alt_cover_days", 0.0),
    )
    base.update(kw)
    return HospitalNeed(hospital_id=hospital_id, **base)


def test_pool_never_exceeded():
    needs = [
        _need("H01", usable=0, demand=100, dus=2.0, criticality="CRITICAL"),
        _need("H02", usable=0, demand=100, dus=3.0, criticality="CRITICAL"),
        _need("H03", usable=5000, demand=50, dus=999.0, criticality="LOW"),
    ]
    out = fair_share_allocate(needs, target_cover_days=7.0, safety_days=3.0, max_transport_units=2000)
    assert out["total_allocated_units"] <= out["pool_units"]
    assert out["pool_units"] == 5000 - 3 * 50  # surplus above safety stock only


def test_safety_stock_protected_and_no_churn():
    needs = [
        _need("H01", usable=100, demand=100, dus=5.0),  # needy: must not contribute
        _need("H02", usable=2000, demand=100, dus=999.0),
    ]
    out = fair_share_allocate(needs, target_cover_days=7.0, safety_days=3.0, max_transport_units=2000)
    by_id = {a["hospital_id"]: a for a in out["allocations"]}
    assert by_id["H01"]["contributed_units"] == 0
    assert by_id["H02"]["contributed_units"] == 2000 - 300
    # H02 keeps safety stock: usable - contributed == safety cover
    assert 2000 - by_id["H02"]["contributed_units"] == 300


def test_priority_order_respected_when_pool_short():
    needs = [
        _need("HLOW", usable=0, demand=50, dus=20.0, criticality="LOW"),
        _need("HCRIT", usable=0, demand=50, dus=1.0, criticality="CRITICAL"),
        _need("HSRC", usable=600, demand=50, dus=999.0, criticality="LOW"),
    ]
    out = fair_share_allocate(needs, target_cover_days=7.0, safety_days=3.0, max_transport_units=2000)
    by_id = {a["hospital_id"]: a for a in out["allocations"]}
    # Pool = 600 - 150 = 450; critical need = 350 -> filled first, remainder to low.
    assert by_id["HCRIT"]["allocated_units"] == 350
    assert by_id["HCRIT"]["unmet_units"] == 0
    assert by_id["HLOW"]["allocated_units"] == 100
    assert by_id["HLOW"]["unmet_units"] == 250
    assert by_id["HCRIT"]["rank"] < by_id["HLOW"]["rank"]


def test_unmet_math_and_transport_cap():
    needs = [
        _need("H01", usable=0, demand=500, dus=1.0, criticality="CRITICAL"),
        _need("HSRC", usable=20000, demand=10, dus=999.0, criticality="LOW"),
    ]
    out = fair_share_allocate(needs, target_cover_days=7.0, safety_days=3.0, max_transport_units=1000)
    row = next(a for a in out["allocations"] if a["hospital_id"] == "H01")
    assert row["need_units"] == 3500
    assert row["allocated_units"] == 1000  # capped by transport
    assert row["need_units"] == row["allocated_units"] + row["unmet_units"]
    assert row["fully_covered"] is False
    assert out["all_needs_met"] is False


def test_no_deficit_means_no_allocation():
    needs = [_need("H01", usable=5000, demand=50, dus=999.0)]
    out = fair_share_allocate(needs, target_cover_days=7.0, safety_days=3.0, max_transport_units=2000)
    assert out["total_need_units"] == 0
    assert out["total_allocated_units"] == 0
    assert out["allocations"][0]["allocated_units"] == 0


def test_explanations_present_and_summary_honest():
    needs = [
        _need("H01", usable=0, demand=100, dus=2.0, criticality="CRITICAL"),
        _need("HSRC", usable=5000, demand=50, dus=999.0, criticality="LOW"),
    ]
    out = fair_share_allocate(needs, target_cover_days=7.0, safety_days=3.0, max_transport_units=2000)
    for row in out["allocations"]:
        assert row["explanation"], f"missing explanation for {row['hospital_id']}"
    assert out["summary"]
    assert out["all_needs_met"] is True
    assert "fully covered" in out["summary"]


def test_emergency_boost_raises_priority():
    from app.services.allocation_service import priority_for_need

    base = _need("H01", usable=0, demand=100, dus=6.0, criticality="HIGH", emergency_recent=10)
    boosted = _need("H01", usable=0, demand=150, dus=6.0, criticality="HIGH", emergency_recent=15)
    for need in (base, boosted):
        need.need_units = 700

    s_base, _ = priority_for_need(base)
    s_boost, _ = priority_for_need(boosted)
    assert s_boost > s_base


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_api_fair_share_shape(client: TestClient):
    res = client.post(
        "/api/v1/allocation/fair-share",
        json={"medicine_id": "M001", "target_cover_days": 7.0, "safety_days": 3.0},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["medicine_id"] == "M001"
    assert body["simulated"] is False
    baseline = body["baseline"]
    assert baseline["total_allocated_units"] <= baseline["pool_units"]
    assert len(baseline["allocations"]) >= 1
    first = baseline["allocations"][0]
    for key in ("rank", "hospital_id", "priority_score", "need_units", "allocated_units", "unmet_units", "explanation"):
        assert key in first


def test_api_fair_share_with_scenario(client: TestClient):
    res = client.post(
        "/api/v1/allocation/fair-share",
        json={
            "medicine_id": "M001",
            "emergency_scenario": {"hospital_id": "H02", "demand_uplift_pct": 100.0},
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["simulated"] is True
    assert body["scenario"] is not None
    assert body["scenario_delta"]
    assert any("hospital_id" in d and "delta_units" in d for d in body["scenario_delta"])


def test_api_unknown_medicine_404(client: TestClient):
    res = client.post("/api/v1/allocation/fair-share", json={"medicine_id": "NOPE-999"})
    assert res.status_code == 404


def test_api_approval_roundtrip(client: TestClient):
    run_res = client.post("/api/v1/allocation/fair-share", json={"medicine_id": "M001"})
    assert run_res.status_code == 200
    result = run_res.json()["baseline"]
    sub = client.post(
        "/api/v1/allocation/runs",
        json={
            "request": {"medicine_id": "M001"},
            "result": result,
            "created_by": "test-reviewer",
        },
    )
    assert sub.status_code == 200, sub.text
    run_id = sub.json()["run_id"]
    assert sub.json()["status"] == "PENDING"

    rev = client.post(
        f"/api/v1/allocation/runs/{run_id}/review",
        json={"decision": "APPROVED", "reviewer": "Dr. Test", "note": "covers critical need"},
    )
    assert rev.status_code == 200, rev.text
    assert rev.json()["decision"] == "APPROVED"

    detail = client.get(f"/api/v1/allocation/runs/{run_id}")
    assert detail.status_code == 200
    assert detail.json()["status"] == "APPROVED"
    assert len(detail.json()["approvals"]) == 1


def test_api_unknown_run_404(client: TestClient):
    res = client.post(
        "/api/v1/allocation/runs/does-not-exist/review",
        json={"decision": "REJECTED", "reviewer": "Dr. Test"},
    )
    assert res.status_code == 404
