import { useEffect, useMemo, useState } from "react";
import {
  Search,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getNetworkPriorities, getStockoutRisks, type PriorityRow } from "../api/medpredict";
import { runDemandScenario, type ScenarioResponse } from "../api/forecast";
import { useAuth } from "../context/AuthContext";
import RiskBadge from "../components/RiskBadge";

const BAR_COLORS: Record<string, string> = {
  Critical: "#e11d48", // rose-600
  High: "#f97316",     // orange-500
  Medium: "#eab308",   // yellow-500
};

const DIMENSIONS = [
  { key: "patientLoad", label: "Patient Load", max: 20, color: "bg-indigo-600", text: "text-indigo-700" },
  { key: "emergency", label: "Emergency Surge", max: 20, color: "bg-rose-600", text: "text-rose-700" },
  { key: "stockout", label: "Stockout Imminence", max: 20, color: "bg-amber-500", text: "text-amber-700" },
  { key: "criticality", label: "Clinical Criticality", max: 20, color: "bg-purple-600", text: "text-purple-700" },
  { key: "alternatives", label: "No Alternative SKUs", max: 20, color: "bg-sky-600", text: "text-sky-700" },
] as const;

export default function Priority() {
  const { user } = useAuth();
  const currentHospitalName = user?.name ?? "Hospital A";

  const [priorities, setPriorities] = useState<PriorityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [levelFilter, setLevelFilter] = useState<"All" | "Critical" | "High" | "Medium">("All");
  const [searchTerm, setSearchTerm] = useState("");

  // Fair-share emergency simulation (adapted from #58 to our /simulation/run API).
  const [simHospitalId, setSimHospitalId] = useState("");
  const [uplift, setUplift] = useState(40);
  const [simResult, setSimResult] = useState<ScenarioResponse | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getNetworkPriorities()
      .then(setPriorities)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const myPriority = priorities.find((p) => p.hospital === currentHospitalName);
  const myRank = priorities.findIndex((p) => p.hospital === currentHospitalName) + 1;

  const filteredPriorities = useMemo(() => {
    return priorities.filter((p) => {
      if (levelFilter !== "All" && p.level !== levelFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesHosp = p.hospital.toLowerCase().includes(q);
        const matchesReason = p.reason.toLowerCase().includes(q);
        if (!matchesHosp && !matchesReason) return false;
      }
      return true;
    });
  }, [priorities, levelFilter, searchTerm]);

  // Top-5 cap: the ranked entries shown on charts and cards.
  const visibleFive = useMemo(() => filteredPriorities.slice(0, 5), [filteredPriorities]);

  useEffect(() => {
    if (!simHospitalId && visibleFive.length > 0) {
      setSimHospitalId(visibleFive[0].hospital_id);
    }
  }, [visibleFive, simHospitalId]);

  async function runFairShare() {
    if (!simHospitalId) return;
    setSimLoading(true);
    setSimError(null);
    setSimResult(null);
    try {
      const risks = await getStockoutRisks(simHospitalId);
      const pool = risks.filter((r) => r.days_until_stockout != null);
      const candidates = pool.length > 0 ? pool : risks;
      if (candidates.length === 0) throw new Error("No demand data for this hospital.");
      const worst = [...candidates].sort(
        (a, b) => (a.days_until_stockout ?? 999) - (b.days_until_stockout ?? 999),
      )[0];
      const res = await runDemandScenario(simHospitalId, worst.medicine_id, uplift);
      setSimResult(res);
    } catch (err: unknown) {
      setSimError(err instanceof Error ? err.message : String(err));
    } finally {
      setSimLoading(false);
    }
  }

  // Re-rank the visible five with simulated urgency for the surged hospital.
  const reranked = useMemo(() => {
    if (!simResult || !simHospitalId) return null;
    const mult = 1 + simResult.demand_increase_pct / 100;
    const simDays = simResult.simulated_days_until_stockout;
    return visibleFive
      .map((p, idx) => {
        if (p.hospital_id !== simHospitalId) {
          return { ...p, simScore: p.score, baseRank: idx };
        }
        const stockoutSim =
          simDays == null ? p.breakdown.stockout : Math.max(0, 20 - simDays * 4);
        const emergencySim = Math.min(20, p.breakdown.emergency * mult);
        const simScore = Math.round(
          p.score - p.breakdown.stockout - p.breakdown.emergency + stockoutSim + emergencySim,
        );
        return { ...p, simScore, baseRank: idx };
      })
      .sort((a, b) => b.simScore - a.simScore)
      .map((p, i) => ({ ...p, moved: p.baseRank - i, rank: i + 1 }));
  }, [simResult, simHospitalId, visibleFive]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm font-semibold text-slate-500">
        Computing network priority scores…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-6 text-rose-900 shadow-sm">
        <h3 className="font-bold">Could not load network priorities</h3>
        <p className="mt-1 text-xs text-rose-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            {currentHospitalName} — Allocation Urgency Index
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Network priority ranking determining urgency for incoming emergency supply redistributions.
            Scores are derived deterministically from each facility's live stock-out risk signals.
          </p>
        </div>
      </div>

      {/* Your Organization Urgency Status Banner */}
      {myPriority && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/80 via-blue-50/50 to-white p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-bold text-white">
                  Your Facility Status
                </span>
                <span className="text-xs font-bold text-slate-700">Rank #{myRank} of {priorities.length}</span>
              </div>
              <h3 className="text-base font-extrabold text-slate-900 mt-1">
                {currentHospitalName} — Composite Score {myPriority.score}/100
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Primary Clinical Need Driver: <strong>{myPriority.reason}</strong>
              </p>
            </div>

            <div className="flex items-center gap-3">
              <RiskBadge
                level={myPriority.level === "Critical" ? "Critical" : myPriority.level === "High" ? "High" : "Medium"}
                size="md"
              />
            </div>
          </div>
        </div>
      )}

      {/* Priority Horizontal Bar Chart */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Composite Urgency Scores (0-100)
            </h3>
            <p className="text-xs text-slate-500">
              Evaluates real-time patient admissions, stockout severity, and ICU medicine criticality
            </p>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={visibleFive.map((p) => ({
              name: p.hospital.split(" ")[0],
              score: p.score,
              level: p.level,
              fullName: p.hospital,
            }))}
            layout="vertical"
            margin={{ top: 10, right: 20, bottom: 5, left: 30 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} width={90} />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const d = payload[0].payload;
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg">
                      <p className="font-bold text-slate-900">{d.fullName}</p>
                      <div className="mt-1 flex items-center justify-between gap-4 font-semibold">
                        <span className="text-slate-600">Urgency Score:</span>
                        <span className="text-rose-600 font-bold">{d.score} / 100</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-slate-500 text-[11px]">
                        <span>Tier:</span>
                        <span className="font-bold text-slate-700">{d.level}</span>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="score" radius={[0, 4, 4, 0]}>
              {visibleFive.map((p) => (
                <Cell key={p.hospital_id} fill={BAR_COLORS[p.level] ?? "#64748b"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Interactive Filters & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-1 text-xs">
          <button
            onClick={() => setLevelFilter("All")}
            className={`rounded-md px-3 py-1 font-semibold transition-colors ${
              levelFilter === "All" ? "bg-indigo-600 text-white" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            All Tiers ({priorities.length})
          </button>
          <button
            onClick={() => setLevelFilter("Critical")}
            className={`rounded-md px-3 py-1 font-semibold transition-colors ${
              levelFilter === "Critical" ? "bg-rose-600 text-white" : "text-rose-700 hover:bg-rose-50"
            }`}
          >
            Critical
          </button>
          <button
            onClick={() => setLevelFilter("High")}
            className={`rounded-md px-3 py-1 font-semibold transition-colors ${
              levelFilter === "High" ? "bg-amber-600 text-white" : "text-amber-800 hover:bg-amber-50"
            }`}
          >
            High
          </button>
          <button
            onClick={() => setLevelFilter("Medium")}
            className={`rounded-md px-3 py-1 font-semibold transition-colors ${
              levelFilter === "Medium" ? "bg-yellow-600 text-white" : "text-yellow-800 hover:bg-yellow-50"
            }`}
          >
            Medium
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search facility or clinical driver..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full sm:w-64 rounded-xl border border-slate-200 bg-white pl-8 pr-7 py-1.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Ranked Hospital Cards List — top 5 */}
      {filteredPriorities.length > 5 && (
        <p className="text-xs text-slate-500">
          Showing top 5 of {filteredPriorities.length} ranked facilities.
        </p>
      )}
      <ol className="grid gap-4">
        {visibleFive.map((p, i) => {
          const isCriticalTier = p.level === "Critical";
          const isMyHospital = p.hospital === currentHospitalName;

          return (
            <li
              key={p.hospital_id}
              className={`rounded-2xl border p-5 shadow-sm transition-all duration-200 hover:shadow-md ${
                isMyHospital
                  ? "border-indigo-400 bg-gradient-to-r from-indigo-50/50 via-white to-indigo-50/20 ring-1 ring-indigo-400/50"
                  : isCriticalTier
                  ? "border-rose-200 bg-gradient-to-r from-white via-rose-50/20 to-rose-50/40"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold text-sm text-white shadow-sm ${
                      i === 0
                        ? "bg-rose-600 shadow-rose-600/30"
                        : i === 1
                        ? "bg-amber-500 shadow-amber-500/30"
                        : "bg-indigo-600 shadow-indigo-600/30"
                    }`}
                  >
                    #{i + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-sm">{p.hospital}</h3>
                      {isMyHospital && (
                        <span className="rounded-full bg-indigo-100 text-indigo-800 px-2 py-0.5 text-[10px] font-extrabold uppercase border border-indigo-200">
                          Your Facility
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-rose-700 font-medium mt-0.5">
                      Clinical Driver: <strong>{p.reason}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                  <div className="text-right">
                    <span className="text-2xl font-black text-slate-900">{p.score}</span>
                    <span className="text-xs text-slate-400 font-semibold">/100</span>
                  </div>
                  <RiskBadge
                    level={p.level === "Critical" ? "Critical" : p.level === "High" ? "High" : "Medium"}
                    size="md"
                  />
                </div>
              </div>

              {/* Multi-factor Score Breakdown */}
              <div className="mt-4 space-y-2">
                <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <span>Dimension Contribution Breakdown:</span>
                  <span>Points (per-dimension max)</span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {DIMENSIONS.map((d) => {
                    const score = p.breakdown[d.key];
                    const pct = Math.min(100, Math.round((score / d.max) * 100));

                    return (
                      <div key={d.key} className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium text-slate-600 text-[11px]">{d.label}</span>
                          <span className="font-bold text-slate-900 font-mono text-[11px]">{score}/{d.max}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full rounded-full ${d.color} transition-all duration-300`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Fair share under emergency demand (adapted from #58).
          Uplift one hospital's emergency demand, recalculate via the
          simulation API, and re-rank the top 5 — results labeled simulated. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Fair Share — Emergency Demand Simulation</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Uplift one hospital's emergency demand and recalculate — simulated results update the ranking below.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="Surge hospital"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={simHospitalId}
            onChange={(e) => setSimHospitalId(e.target.value)}
          >
            {visibleFive.map((p) => (
              <option key={p.hospital_id} value={p.hospital_id}>{p.hospital}</option>
            ))}
          </select>
          {[20, 40, 60].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => setUplift(pct)}
              className={`rounded px-3 py-1 text-sm font-semibold ${
                uplift === pct ? "bg-slate-900 text-white" : "border border-slate-300 hover:bg-slate-100"
              }`}
            >
              +{pct}%
            </button>
          ))}
          <button
            type="button"
            onClick={runFairShare}
            disabled={simLoading || !simHospitalId}
            className="rounded bg-indigo-600 px-3 py-1 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {simLoading ? "Running…" : "Run Simulation"}
          </button>
        </div>
        {simError && <p className="mt-2 text-sm text-red-700">{simError}</p>}
        {simResult && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  label: "Stock-out",
                  before: simResult.baseline_stockout_date ?? "—",
                  after: simResult.simulated_stockout_date ?? "—",
                },
                { label: "Risk", before: simResult.baseline_risk_level, after: simResult.simulated_risk_level },
                {
                  label: "Recommended order",
                  before: `${simResult.baseline_recommended_order.toLocaleString()} units`,
                  after: `${simResult.simulated_recommended_order.toLocaleString()} units`,
                },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
                  <p className="mt-1 text-sm"><span className="text-slate-500">Before:</span> <strong>{c.before}</strong></p>
                  <p className="text-sm">
                    <span className="text-slate-500">After +{simResult.demand_increase_pct}%:</span>{" "}
                    <strong className="text-indigo-700">{c.after}</strong>
                  </p>
                </div>
              ))}
            </div>
            {reranked && (
              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Re-ranked top 5 (simulated)
                </h3>
                <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {reranked.map((p) => (
                    <li key={p.hospital_id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>
                        <strong className="mr-2">#{p.rank}</strong>
                        {p.hospital}
                        {p.moved !== 0 && (
                          <span className={`ml-2 text-xs font-bold ${p.moved > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                            {p.moved > 0 ? `▲ up ${p.moved}` : `▼ down ${-p.moved}`}
                          </span>
                        )}
                      </span>
                      <span className="font-mono font-bold">
                        {p.score} → <span className="text-indigo-700">{p.simScore}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <p className="text-xs text-slate-600">{simResult.summary}</p>
          </div>
        )}
      </section>
    </div>
  );
}
