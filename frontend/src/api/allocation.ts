/** Typed Fair-Share Allocation API layer (single-medicine triage + approvals). */

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Allocation ${path} failed: ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  return (await res.json()) as T;
}

export interface PriorityBreakdown {
  stockout: number;
  criticality: number;
  emergency: number;
  patients: number;
  alternatives: number;
}

export interface HospitalAllocation {
  rank: number;
  hospital_id: string;
  hospital_name: string;
  priority_score: number;
  priority_breakdown: PriorityBreakdown;
  need_units: number;
  allocated_units: number;
  unmet_units: number;
  fully_covered: boolean;
  contributor: boolean;
  contributed_units: number;
  explanation: string;
}

export interface Contribution {
  hospital_id: string;
  hospital_name: string;
  contributed_units: number;
}

export interface HospitalDelta {
  hospital_id: string;
  hospital_name: string;
  priority_before: number;
  priority_after: number;
  allocated_before: number;
  allocated_after: number;
  delta_units: number;
}

export interface AllocationResult {
  run_id: string | null;
  medicine_id: string;
  medicine_name: string;
  unit: string;
  pool_units: number;
  total_need_units: number;
  total_allocated_units: number;
  total_unmet_units: number;
  all_needs_met: boolean;
  solver: string;
  contribution_rule: string;
  summary: string;
  contributions: Contribution[];
  allocations: HospitalAllocation[];
}

export interface FairShareRequest {
  medicine_id: string;
  target_cover_days: number;
  safety_days: number;
  max_transport_units: number;
  emergency_scenario?: { hospital_id: string; demand_uplift_pct: number } | null;
}

export interface FairShareResponse {
  medicine_id: string;
  medicine_name: string;
  baseline: AllocationResult;
  scenario: AllocationResult | null;
  scenario_delta: HospitalDelta[] | null;
  simulated: boolean;
}

export interface RunSummary {
  run_id: string;
  medicine_id: string;
  medicine_name: string;
  status: string;
  created_at: string | null;
}

export interface ApprovalRecord {
  id: string;
  run_id: string;
  decision: string;
  reviewer: string;
  note: string | null;
  created_at: string | null;
}

export function postFairShare(body: FairShareRequest, signal?: AbortSignal): Promise<FairShareResponse> {
  return request<FairShareResponse>("/api/v1/allocation/fair-share", {
    method: "POST",
    body: JSON.stringify({ ...body, emergency_scenario: body.emergency_scenario ?? null }),
    signal,
  });
}

export function submitRun(
  req: FairShareRequest,
  result: AllocationResult,
  createdBy?: string,
): Promise<RunSummary> {
  return request<RunSummary>("/api/v1/allocation/runs", {
    method: "POST",
    body: JSON.stringify({ request: { ...req, emergency_scenario: req.emergency_scenario ?? null }, result, created_by: createdBy ?? null }),
  });
}

export function reviewRun(runId: string, decision: "APPROVED" | "REJECTED", reviewer: string, note?: string): Promise<ApprovalRecord> {
  return request<ApprovalRecord>(`/api/v1/allocation/runs/${encodeURIComponent(runId)}/review`, {
    method: "POST",
    body: JSON.stringify({ decision, reviewer, note: note ?? null }),
  });
}
