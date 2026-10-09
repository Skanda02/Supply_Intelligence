"""Pydantic schemas for the Fair-Share Allocation Engine (single-medicine triage)."""

from pydantic import BaseModel, Field
from typing import Literal


class EmergencyScenario(BaseModel):
    hospital_id: str = Field(description="Hospital whose emergency demand is uplifted")
    demand_uplift_pct: float = Field(default=50.0, ge=0, le=500, description="Extra emergency demand in percent")


class FairShareRequest(BaseModel):
    medicine_id: str = Field(description="Medicine to allocate across hospitals")
    target_cover_days: float = Field(default=7.0, ge=1, le=30, description="Days of cover each hospital should reach")
    safety_days: float = Field(default=3.0, ge=0, le=14, description="Safety stock kept back at contributing hospitals")
    max_transport_units: int = Field(default=2000, gt=0, description="Per-hospital transport cap per allocation")
    emergency_scenario: EmergencyScenario | None = Field(default=None, description="Optional emergency simulation")


class PriorityBreakdown(BaseModel):
    stockout: float = 0
    criticality: float = 0
    emergency: float = 0
    patients: float = 0
    alternatives: float = 0


class HospitalAllocation(BaseModel):
    rank: int
    hospital_id: str
    hospital_name: str
    priority_score: float
    priority_breakdown: PriorityBreakdown
    need_units: int
    allocated_units: int
    unmet_units: int
    fully_covered: bool
    contributor: bool = False
    contributed_units: int = 0
    explanation: str


class Contribution(BaseModel):
    hospital_id: str
    hospital_name: str
    contributed_units: int


class HospitalDelta(BaseModel):
    hospital_id: str
    hospital_name: str
    priority_before: float
    priority_after: float
    allocated_before: int
    allocated_after: int
    delta_units: int


class AllocationResult(BaseModel):
    run_id: str | None = None
    medicine_id: str
    medicine_name: str
    unit: str
    pool_units: int
    total_need_units: int
    total_allocated_units: int
    total_unmet_units: int
    all_needs_met: bool
    solver: str
    contribution_rule: str
    summary: str
    contributions: list[Contribution]
    allocations: list[HospitalAllocation]


class FairShareResponse(BaseModel):
    medicine_id: str
    medicine_name: str
    baseline: AllocationResult
    scenario: AllocationResult | None = None
    scenario_delta: list[HospitalDelta] | None = None
    simulated: bool = False


class CreateRunRequest(BaseModel):
    request: FairShareRequest
    result: AllocationResult
    created_by: str | None = None


class RunSummary(BaseModel):
    run_id: str
    medicine_id: str
    medicine_name: str
    status: str
    created_at: str | None = None


class ReviewRequest(BaseModel):
    decision: Literal["APPROVED", "REJECTED"]
    reviewer: str = Field(min_length=1, description="Name or role of the reviewer")
    note: str | None = None


class ApprovalRecord(BaseModel):
    id: str
    run_id: str
    decision: str
    reviewer: str
    note: str | None = None
    created_at: str | None = None


class RunDetail(BaseModel):
    run_id: str
    medicine_id: str
    medicine_name: str
    status: str
    params: dict
    result: dict
    created_at: str | None = None
    approvals: list[ApprovalRecord]
