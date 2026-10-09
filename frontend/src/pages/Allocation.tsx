import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CheckCircle,
  ClipboardCheck,
  FlaskConical,
  Scale,
  Stamp,
  Truck,
} from "lucide-react";
import {
  postFairShare,
  reviewRun,
  submitRun,
  type FairShareRequest,
  type FairShareResponse,
} from "../api/allocation";
import { getMedicines, type MedicineOption } from "../api/forecast";
import { useAuth } from "../context/AuthContext";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15";

export default function Allocation() {
  const { user } = useAuth();

  const [medicines, setMedicines] = useState<MedicineOption[]>([]);
  const [medicineId, setMedicineId] = useState("");
  const [coverDays, setCoverDays] = useState("7");
  const [safetyDays, setSafetyDays] = useState("3");
  const [transportCap, setTransportCap] = useState("2000");

  const [resp, setResp] = useState<FairShareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Emergency simulation
  const [simHospital, setSimHospital] = useState("");
  const [uplift, setUplift] = useState(50);

  // Approval
  const [reviewer, setReviewer] = useState(user?.userName ?? "");
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [approvalMsg, setApprovalMsg] = useState<string | null>(null);

  useEffect(() => {
    getMedicines()
      .then((list) => {
        setMedicines(list);
        if (list.length > 0) setMedicineId((cur) => cur || list[0].id);
      })
      .catch(() => setMedicines([]));
  }, []);

  const hospitals = useMemo(
    () => (resp ? resp.baseline.allocations.map((a) => ({ id: a.hospital_id, name: a.hospital_name })) : []),
    [resp],
  );

  useEffect(() => {
    if (hospitals.length > 0) setSimHospital((cur) => cur || hospitals[0].id);
  }, [hospitals]);

  function buildRequest(withScenario: boolean): FairShareRequest {
    return {
      medicine_id: medicineId,
      target_cover_days: Math.max(1, Number(coverDays) || 7),
      safety_days: Math.max(0, Number(safetyDays) || 0),
      max_transport_units: Math.max(1, Math.floor(Number(transportCap) || 2000)),
      emergency_scenario: withScenario && simHospital ? { hospital_id: simHospital, demand_uplift_pct: uplift } : null,
    };
  }

  async function run(withScenario: boolean) {
    if (!medicineId) {
      setError("Choose a medicine first.");
      return;
    }
    setLoading(true);
    setError(null);
    setApprovalMsg(null);
    try {
      const data = await postFairShare(buildRequest(withScenario));
      setResp(data);
      setRunId(null);
      setRunStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function submitForApproval() {
    if (!resp) return;
    if (!reviewer.trim()) {
      setApprovalMsg("Enter the reviewer's name before submitting.");
      return;
    }
    setApprovalMsg(null);
    try {
      const summary = await submitRun(buildRequest(false), resp.baseline, reviewer.trim());
      setRunId(summary.run_id);
      setRunStatus(summary.status);
      setApprovalMsg(`Submitted for approval — run ${summary.run_id.slice(0, 8)}… is PENDING review.`);
    } catch (err) {
      setApprovalMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (!runId) return;
    if (!reviewer.trim()) {
      setApprovalMsg("Enter the reviewer's name before deciding.");
      return;
    }
    try {
      const rec = await reviewRun(runId, decision, reviewer.trim());
      setRunStatus(rec.decision);
      setApprovalMsg(`Run ${runId.slice(0, 8)}… ${rec.decision} by ${rec.reviewer}.`);
    } catch (err) {
      setApprovalMsg(err instanceof Error ? err.message : String(err));
    }
  }

  const baseline = resp?.baseline ?? null;
  const simDelta = resp?.simulated && resp?.scenario && resp?.scenario_delta ? resp.scenario_delta : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0a1a33] via-[#0e2a52] to-[#0a3d3a] p-6 text-white shadow-xl sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-teal-400/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-indigo-500/25 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-500 text-slate-950 shadow-lg">
            <Scale className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">Fair-Share Allocation Engine</h2>
            <p className="mt-1 max-w-3xl text-[13px] text-slate-300">
              One scarce medicine, many hospitals in need. The engine ranks every hospital by stockout urgency,
              criticality, emergency load and patient volume, then allocates the shared pool in priority order —
              never exceeding available stock and always protecting each source's safety cover.
            </p>
          </div>
          <span className="rounded-full border border-teal-300/30 bg-teal-400/15 px-3 py-1 text-[11px] font-bold text-teal-200">
            DETERMINISTIC · EXPLAINABLE
          </span>
        </div>
      </section>

      {/* Controls */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-extrabold text-slate-900">Allocation inputs</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="block text-xs font-bold text-slate-600 sm:col-span-2 xl:col-span-1">
            Medicine
            <select value={medicineId} onChange={(e) => setMedicineId(e.target.value)} className={`${inputCls} mt-1 font-medium text-slate-800`}>
              {medicines.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">
            Target cover (days)
            <input value={coverDays} onChange={(e) => setCoverDays(e.target.value)} type="number" min={1} max={30} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs font-bold text-slate-600">
            Safety stock (days)
            <input value={safetyDays} onChange={(e) => setSafetyDays(e.target.value)} type="number" min={0} max={14} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs font-bold text-slate-600">
            Transport cap (units)
            <input value={transportCap} onChange={(e) => setTransportCap(e.target.value)} type="number" min={1} className={`${inputCls} mt-1`} />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => run(false)}
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700 active:scale-95 disabled:opacity-50 sm:w-auto"
            >
              <Scale className="h-4 w-4" /> {loading ? "Computing…" : "Run allocation"}
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800" role="alert">
            {error}
          </p>
        )}
      </section>

      {baseline && (
        <>
          {/* Summary */}
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Shared pool", value: baseline.pool_units.toLocaleString(), sub: `${baseline.contributions.length} contributor${baseline.contributions.length === 1 ? "" : "s"} · safety protected` },
              { label: "Allocated / needed", value: `${baseline.total_allocated_units.toLocaleString()} / ${baseline.total_need_units.toLocaleString()}`, sub: "units across needy hospitals" },
              { label: "Unmet demand", value: baseline.total_unmet_units.toLocaleString(), sub: baseline.all_needs_met ? "every deficit fully covered" : "pool exhausted — see ranks" },
              { label: "Solver", value: baseline.all_needs_met ? "All needs met" : "Triage applied", sub: baseline.solver },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{s.label}</p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{s.value}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500" title={s.sub}>{s.sub}</p>
              </div>
            ))}
          </section>

          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-600 shadow-sm">
            <strong className="text-slate-900">How it works:</strong> {baseline.summary} {baseline.contribution_rule}
          </p>

          {/* Allocations table */}
          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900">
                Recommended allocation — {baseline.medicine_name} ({baseline.unit})
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">Priority order · expand a row for the full explanation</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3 font-extrabold">Rank · Hospital</th>
                    <th className="px-5 py-3 font-extrabold">Priority</th>
                    <th className="px-5 py-3 font-extrabold">Need</th>
                    <th className="px-5 py-3 font-extrabold">Allocated</th>
                    <th className="px-5 py-3 font-extrabold">Unmet</th>
                    <th className="px-5 py-3 font-extrabold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {baseline.allocations.map((a) => (
                    <tr key={a.hospital_id} className="align-top transition hover:bg-teal-50/40">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-extrabold text-white">
                            {a.rank}
                          </span>
                          <div>
                            <p className="flex items-center gap-1.5 font-bold text-slate-900">
                              <Building2 className="h-3.5 w-3.5 text-slate-400" /> {a.hospital_name}
                            </p>
                            {a.contributor && (
                              <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                <Truck className="h-3 w-3" /> +{a.contributed_units.toLocaleString()} to pool
                              </p>
                            )}
                          </div>
                        </div>
                        <details className="mt-1.5 text-xs text-slate-500">
                          <summary className="cursor-pointer font-bold text-teal-700 hover:underline">Why this amount?</summary>
                          <p className="mt-1 leading-relaxed">{a.explanation}</p>
                        </details>
                      </td>
                      <td className="px-5 py-3">
                        <p className="font-extrabold tabular-nums text-slate-900">{a.priority_score}</p>
                        <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500" style={{ width: `${Math.min(100, a.priority_score)}%` }} />
                        </div>
                      </td>
                      <td className="px-5 py-3 font-bold tabular-nums text-slate-700">{a.need_units.toLocaleString()}</td>
                      <td className="px-5 py-3 font-extrabold tabular-nums text-teal-700">{a.allocated_units.toLocaleString()}</td>
                      <td className="px-5 py-3 font-bold tabular-nums text-slate-700">{a.unmet_units.toLocaleString()}</td>
                      <td className="px-5 py-3">
                        {a.need_units === 0 ? (
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">No deficit</span>
                        ) : a.fully_covered ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                            <CheckCircle className="h-3 w-3" /> Covered
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full border border-rose-200 bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-800">Partial</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Simulate emergency */}
          <section className="rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50/80 to-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md">
                <FlaskConical className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-extrabold text-slate-900">Simulate Emergency</h3>
                <p className="text-[11px] text-slate-500">Uplift one hospital's emergency demand and recalculate — results are labeled simulated</p>
              </div>
              <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">What-if</span>
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block flex-1 text-xs font-bold text-slate-600">
                Hospital under pressure
                <select value={simHospital} onChange={(e) => setSimHospital(e.target.value)} className={`${inputCls} mt-1`}>
                  {hospitals.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </label>
              <label className="block flex-1 text-xs font-bold text-slate-600">
                Demand uplift: +{uplift}%
                <input
                  type="range" min={10} max={200} step={10} value={uplift}
                  onChange={(e) => setUplift(Number(e.target.value))}
                  className="mt-2 w-full accent-amber-600" aria-label="Emergency demand uplift percent"
                />
              </label>
              <button
                type="button" onClick={() => run(true)} disabled={loading}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-amber-600/25 transition hover:bg-amber-700 active:scale-95 disabled:opacity-50"
              >
                <FlaskConical className="h-4 w-4" /> {loading ? "Simulating…" : "Simulate + recalculate"}
              </button>
            </div>

            {simDelta && (
              <div className="mt-4 overflow-hidden rounded-xl border border-amber-200 bg-white">
                <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-2.5">
                  <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white">SIMULATED</span>
                  <p className="text-xs font-bold text-slate-800">Before → after: +{uplift}% emergency demand at {simDelta.find((d) => d.hospital_id === simHospital)?.hospital_name ?? simHospital}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-2.5 font-extrabold">Hospital</th>
                        <th className="px-4 py-2.5 font-extrabold">Priority</th>
                        <th className="px-4 py-2.5 font-extrabold">Allocated before</th>
                        <th className="px-4 py-2.5 font-extrabold">Allocated after</th>
                        <th className="px-4 py-2.5 font-extrabold">Change</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {simDelta.map((d) => (
                        <tr key={d.hospital_id} className={d.hospital_id === simHospital ? "bg-amber-50/60" : undefined}>
                          <td className="px-4 py-2.5 font-bold text-slate-900">{d.hospital_name}</td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-600">{d.priority_before} → <strong className="text-slate-900">{d.priority_after}</strong></td>
                          <td className="px-4 py-2.5 tabular-nums text-slate-600">{d.allocated_before.toLocaleString()}</td>
                          <td className="px-4 py-2.5 font-extrabold tabular-nums text-slate-900">{d.allocated_after.toLocaleString()}</td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-extrabold tabular-nums ${d.delta_units > 0 ? "bg-emerald-100 text-emerald-800" : d.delta_units < 0 ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-500"}`}>
                              {d.delta_units > 0 ? "+" : ""}{d.delta_units.toLocaleString()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* Approval */}
          <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
                <Stamp className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-extrabold text-slate-900">Review & approval</h3>
                <p className="text-[11px] text-slate-500">Nothing executes until authorized staff approve the recommendation</p>
              </div>
              {runStatus && (
                <span className={`rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide ${runStatus === "APPROVED" ? "bg-emerald-100 text-emerald-800" : runStatus === "REJECTED" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"}`}>
                  {runStatus}
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="block flex-1 text-xs font-bold text-slate-600">
                Reviewer name / role
                <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. Dr. Rao, Pharmacy Head" className={`${inputCls} mt-1`} />
              </label>
              {!runId ? (
                <button
                  type="button" onClick={submitForApproval}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-extrabold text-white transition hover:bg-slate-700 active:scale-95"
                >
                  <ClipboardCheck className="h-4 w-4" /> Submit for approval
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button" onClick={() => decide("APPROVED")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white transition hover:bg-emerald-700 active:scale-95"
                  >
                    <CheckCircle className="h-4 w-4" /> Approve
                  </button>
                  <button
                    type="button" onClick={() => decide("REJECTED")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-sm font-extrabold text-rose-700 transition hover:bg-rose-50 active:scale-95"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
            {approvalMsg && (
              <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700" role="status">{approvalMsg}</p>
            )}
            <p className="mt-2 text-[11px] text-slate-400">
              Approvals are stored server-side. Inspect any run at <code>GET /api/v1/allocation/runs/{"{run_id}"}</code>.{" "}
              <Link to="/redistribution" className="inline-flex items-center gap-1 font-bold text-teal-700 hover:underline">
                Open transfer workspace <ArrowRight className="h-3 w-3" />
              </Link>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
