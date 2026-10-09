import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  Boxes,
  BrainCircuit,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  Filter,
  History,
  PackageCheck,
  Search,
  Send,
  Siren,
  TrendingUp,
  Truck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { riskOf, type InventoryRow } from "../api/client";
import {
  formatShortDate,
  getForecast,
  type ForecastPoint,
} from "../api/forecast";
import {
  getDashboard,
  getExpiryRisks,
  getInventory,
  toInventoryRow,
  type DashboardResponse,
  type ExpiryRiskItem,
  type InventoryDetail,
} from "../api/medpredict";
import { useAuth } from "../context/AuthContext";
import ForecastAlerts from "../components/ForecastAlerts";

/* ---------------- helpers ---------------- */

function nearestBatch(detail: InventoryDetail): { date: string; days: number } | null {
  if (detail.batches.length === 0) return null;
  const best = detail.batches.reduce((a, b) => (a.days_to_expiry <= b.days_to_expiry ? a : b));
  return { date: best.expiry_date, days: best.days_to_expiry };
}

type TableStatus = "Critical" | "Low Stock" | "Expiring Soon" | "In Stock";

function tableStatus(detail: InventoryDetail): TableStatus {
  const batch = nearestBatch(detail);
  if (batch && batch.days <= 14) return "Expiring Soon";
  if (detail.risk_level === "CRITICAL") return "Critical";
  if (detail.risk_level === "HIGH" || detail.risk_level === "MEDIUM") return "Low Stock";
  return "In Stock";
}

const STATUS_BADGE: Record<TableStatus, string> = {
  Critical: "bg-rose-100 text-rose-800 border-rose-200",
  "Low Stock": "bg-amber-100 text-amber-800 border-amber-200",
  "Expiring Soon": "bg-orange-100 text-orange-800 border-orange-200",
  "In Stock": "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const RISK_COLORS: Record<string, string> = {
  Critical: "#f43f5e",
  High: "#f97316",
  Medium: "#facc15",
  Safe: "#10b981",
};

const CATEGORY_COLORS = ["#0d9488", "#4f46e5", "#0284c7", "#7c3aed", "#059669", "#ea580c", "#db2777", "#64748b"];

const tooltipBox = "rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl";

/* ---------------- page ---------------- */

type SortKey = "medicine" | "total_quantity" | "days_of_supply" | "expiry";

export default function Dashboard() {
  const { user } = useAuth();
  const hospitalId = user?.id ?? "H01";
  const currentHospitalName = user?.name ?? "Hospital A";

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [details, setDetails] = useState<InventoryDetail[]>([]);
  const [expiryRisks, setExpiryRisks] = useState<ExpiryRiskItem[]>([]);
  const [trend, setTrend] = useState<{ medicine: string; historical: ForecastPoint[]; forecast: ForecastPoint[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Smart table state
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | TableStatus>("All");
  const [sortKey, setSortKey] = useState<SortKey>("days_of_supply");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getDashboard(hospitalId), getInventory(hospitalId), getExpiryRisks(hospitalId)])
      .then(async ([dash, inv, exp]) => {
        if (cancelled) return;
        setDashboard(dash);
        setDetails(inv);
        setExpiryRisks(exp);
        // Demand trend for the lowest-cover medicine (real LightGBM forecast).
        const focus = inv
          .slice()
          .sort((a, b) => a.days_of_supply - b.days_of_supply)
          .find((d) => d.medicine_id);
        if (focus) {
          try {
            const fc = await getForecast(hospitalId, focus.medicine_id, 14);
            if (!cancelled) {
              setTrend({ medicine: focus.medicine_name, historical: fc.historical, forecast: fc.forecast });
            }
          } catch {
            if (!cancelled) setTrend(null);
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hospitalId]);

  useEffect(() => {
    setPage(0);
  }, [query, statusFilter]);

  const rows: InventoryRow[] = useMemo(() => details.map(toInventoryRow), [details]);

  const kpis = dashboard?.kpis;
  const transferCount = dashboard?.redistribution_suggestions.length ?? 0;

  const kpiCards = [
    {
      title: "Total Medicines",
      value: kpis ? String(kpis.total_medicines) : "–",
      hint: kpis ? `${kpis.total_recommended_orders} recommended orders open` : "Live formulary count",
      icon: Boxes,
      tile: "from-teal-500 to-emerald-600",
      glow: "group-hover:shadow-teal-500/20",
    },
    {
      title: "Critical Stockouts",
      value: kpis ? String(kpis.critical_stockout_risks) : "–",
      hint: "Immediate replenishment needed",
      icon: Siren,
      tile: "from-rose-500 to-red-600",
      glow: "group-hover:shadow-rose-500/25",
      alert: (kpis?.critical_stockout_risks ?? 0) > 0,
    },
    {
      title: "Low-Stock Alerts",
      value: kpis ? String(kpis.high_stockout_risks) : "–",
      hint: "High-risk medicines to watch",
      icon: AlertTriangle,
      tile: "from-amber-500 to-orange-600",
      glow: "group-hover:shadow-amber-500/20",
    },
    {
      title: "Expiring Medicines",
      value: kpis ? String(kpis.expiry_risk_batches) : "–",
      hint: kpis ? `${kpis.total_potential_wastage_units.toLocaleString()} units at risk` : "Batches nearing expiry",
      icon: CalendarClock,
      tile: "from-orange-500 to-amber-600",
      glow: "group-hover:shadow-orange-500/20",
    },
    {
      title: "Pending Procurement",
      value: kpis ? String(kpis.pending_procurement_orders) : "–",
      hint: "Purchase orders awaiting delivery",
      icon: ClipboardList,
      tile: "from-indigo-500 to-blue-600",
      glow: "group-hover:shadow-indigo-500/20",
    },
    {
      title: "Transfer Opportunities",
      value: String(transferCount),
      hint: "Peer hospitals with surplus stock",
      icon: ArrowLeftRight,
      tile: "from-emerald-500 to-teal-600",
      glow: "group-hover:shadow-emerald-500/20",
    },
  ];

  // Risk distribution donut (real row data).
  const riskDist = useMemo(() => {
    const counts: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Safe: 0 };
    for (const r of rows) counts[riskOf(r.days_left)] += 1;
    return (Object.keys(counts) as Array<keyof typeof counts>).map((k) => ({ name: k, value: counts[k] }));
  }, [rows]);
  const safeShare = rows.length > 0 ? Math.round(((riskDist.find((d) => d.name === "Safe")?.value ?? 0) / rows.length) * 100) : 100;

  // Days-of-cover bars (real, lowest 8).
  const coverData = useMemo(
    () =>
      rows
        .filter((r) => r.days_left != null && Number.isFinite(r.days_left))
        .sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999))
        .slice(0, 8)
        .map((r) => ({
          name: r.medicine.length > 14 ? `${r.medicine.slice(0, 13)}…` : r.medicine,
          medicine: r.medicine,
          days: Number((r.days_left ?? 0).toFixed(1)),
          level: riskOf(r.days_left),
        })),
    [rows],
  );

  // Expiry timeline (real batch-level risks).
  const expiryBuckets = useMemo(() => {
    const buckets = [
      { name: "≤ 7 days", count: 0 },
      { name: "8–14 days", count: 0 },
      { name: "15–30 days", count: 0 },
      { name: "> 30 days", count: 0 },
    ];
    for (const e of expiryRisks) {
      const d = e.days_to_expiry;
      if (d <= 7) buckets[0].count += 1;
      else if (d <= 14) buckets[1].count += 1;
      else if (d <= 30) buckets[2].count += 1;
      else buckets[3].count += 1;
    }
    return buckets;
  }, [expiryRisks]);

  // Category mix (real quantities).
  const categoryData = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of details) {
      map.set(d.category, (map.get(d.category) ?? 0) + d.total_quantity);
    }
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
  }, [details]);

  // Demand trend series (real LightGBM output).
  const trendData = useMemo(() => {
    if (!trend) return [];
    const hist = trend.historical.map((p) => ({ date: formatShortDate(p.date), actual: p.predicted_demand }));
    const fc = trend.forecast.map((p, i) => ({
      date: formatShortDate(p.date),
      predicted: p.predicted_demand,
      // stitch the line to the last historical point
      ...(i === 0 && hist.length > 0 ? { actual: hist[hist.length - 1].actual } : {}),
    }));
    const byDate = new Map<string, { date: string; actual?: number; predicted?: number }>();
    for (const h of hist) byDate.set(h.date, { date: h.date, actual: h.actual });
    for (const f of fc) {
      const prev = byDate.get(f.date) ?? { date: f.date };
      byDate.set(f.date, { ...prev, ...f });
    }
    return [...byDate.values()];
  }, [trend]);

  // AI insights from live backend signals (no invented statistics).
  const insights = useMemo(() => {
    const list: Array<{ tone: string; icon: typeof Siren; title: string; body: string; action: string; to: string }> = [];
    const crit = dashboard?.critical_alerts[0];
    if (crit) {
      list.push({
        tone: "rose",
        icon: Siren,
        title: `Critical shortage: ${crit.medicine_name}`,
        body: `Down to ${crit.days_until_stockout?.toFixed(1) ?? "?"} days of cover${crit.projected_stockout_date ? ` — projected stockout ${crit.projected_stockout_date}` : ""}. Review replenishment options now.`,
        action: "Open stockout radar",
        to: "/shortage-risk",
      });
    }
    const red = dashboard?.redistribution_suggestions[0];
    if (red) {
      list.push({
        tone: "emerald",
        icon: ArrowLeftRight,
        title: `Transfer available: ${red.medicine_name}`,
        body: `${red.suggested_quantity.toLocaleString()} units at ${red.source_name} → ${red.destination_hospital_name}. ${red.reason}`,
        action: "Open transfers",
        to: "/redistribution",
      });
    }
    const rec = dashboard?.top_recommendations[0];
    if (rec) {
      list.push({
        tone: "indigo",
        icon: PackageCheck,
        title: `Procure ${rec.medicine_name}`,
        body: `${rec.reason} Order ${rec.recommended_quantity.toLocaleString()} units${rec.source_name ? ` from ${rec.source_name}` : ""} — est. ₹${rec.estimated_cost.toLocaleString("en-IN")}, delivery ${rec.expected_delivery_date}.`,
        action: "Review forecast",
        to: "/forecast",
      });
    }
    const exp = dashboard?.expiry_alerts[0];
    if (exp) {
      list.push({
        tone: "amber",
        icon: CalendarClock,
        title: `Expiry risk: ${exp.medicine_name}`,
        body: `Batch ${exp.batch_number} expires in ${exp.days_to_expiry} days — ${exp.potential_wastage.toLocaleString()} units at risk. Prioritize distribution.`,
        action: "Open expiry tracking",
        to: "/expiry-risk",
      });
    }
    return list.slice(0, 4);
  }, [dashboard]);

  const toneStyle: Record<string, { ring: string; tile: string; btn: string }> = {
    rose: {
      ring: "border-rose-200 bg-rose-50/60",
      tile: "bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-md shadow-rose-500/30",
      btn: "bg-rose-600 hover:bg-rose-700",
    },
    emerald: {
      ring: "border-emerald-200 bg-emerald-50/60",
      tile: "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30",
      btn: "bg-emerald-600 hover:bg-emerald-700",
    },
    indigo: {
      ring: "border-indigo-200 bg-indigo-50/60",
      tile: "bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-md shadow-indigo-500/30",
      btn: "bg-indigo-600 hover:bg-indigo-700",
    },
    amber: {
      ring: "border-amber-200 bg-amber-50/60",
      tile: "bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/30",
      btn: "bg-amber-600 hover:bg-amber-700",
    },
  };

  // Activity signals with real dates (no invented timestamps).
  const activity = useMemo(() => {
    type Item = { key: string; icon: typeof Siren; tint: string; text: string; sub: string; to: string };
    const items: Item[] = [];
    for (const a of (dashboard?.critical_alerts ?? []).slice(0, 3)) {
      items.push({
        key: `c-${a.medicine_id}`,
        icon: Siren,
        tint: "bg-rose-100 text-rose-700",
        text: `Critical alert: ${a.medicine_name} stockout risk`,
        sub: a.projected_stockout_date ? `Projected stockout ${a.projected_stockout_date}` : "Below safety stock",
        to: "/shortage-risk",
      });
    }
    for (const r of (dashboard?.top_recommendations ?? []).slice(0, 2)) {
      items.push({
        key: `p-${r.id}`,
        icon: Send,
        tint: "bg-indigo-100 text-indigo-700",
        text: `Procurement: ${r.recommended_quantity.toLocaleString()} units of ${r.medicine_name}`,
        sub: `Expected delivery ${r.expected_delivery_date}`,
        to: "/forecast",
      });
    }
    for (const e of (dashboard?.expiry_alerts ?? []).slice(0, 2)) {
      items.push({
        key: `e-${e.batch_id}`,
        icon: CalendarClock,
        tint: "bg-amber-100 text-amber-700",
        text: `Expiry watch: ${e.medicine_name} batch ${e.batch_number}`,
        sub: `Expires ${e.expiry_date} · ${e.potential_wastage.toLocaleString()} units at risk`,
        to: "/expiry-risk",
      });
    }
    for (const s of (dashboard?.redistribution_suggestions ?? []).slice(0, 2)) {
      items.push({
        key: `t-${s.medicine_id}-${s.source_name}`,
        icon: Truck,
        tint: "bg-emerald-100 text-emerald-700",
        text: `Transfer suggested: ${s.medicine_name} (${s.suggested_quantity.toLocaleString()} units)`,
        sub: `${s.source_name} → ${s.destination_hospital_name} · active suggestion`,
        to: "/redistribution",
      });
    }
    return items.slice(0, 8);
  }, [dashboard]);

  // Smart table pipeline.
  const tableRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = details.filter((d) => {
      if (q && !d.medicine_name.toLowerCase().includes(q) && !d.category.toLowerCase().includes(q)) return false;
      if (statusFilter !== "All" && tableStatus(d) !== statusFilter) return false;
      return true;
    });
    const dir = sortAsc ? 1 : -1;
    return filtered.sort((a, b) => {
      switch (sortKey) {
        case "medicine":
          return a.medicine_name.localeCompare(b.medicine_name) * dir;
        case "total_quantity":
          return (a.total_quantity - b.total_quantity) * dir;
        case "days_of_supply":
          return (a.days_of_supply - b.days_of_supply) * dir;
        case "expiry": {
          const ea = nearestBatch(a)?.days ?? 99999;
          const eb = nearestBatch(b)?.days ?? 99999;
          return (ea - eb) * dir;
        }
      }
    });
  }, [details, query, statusFilter, sortKey, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const pageRows = tableRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const initials = currentHospitalName.split(" ").map((w) => w.charAt(0)).slice(0, 2).join("").toUpperCase();

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading dashboard">
        <div className="h-56 animate-pulse rounded-3xl bg-gradient-to-r from-[#0a1a33] via-[#12325e] to-[#0a1a33]" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-72 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200 lg:col-span-2" />
          <div className="h-72 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-6 text-rose-900 shadow-sm" role="alert">
        <h3 className="font-bold">Could not load the dashboard</h3>
        <p className="mt-1 text-xs text-rose-700">{error ?? "No data returned. Is the backend running on http://localhost:8000?"}</p>
      </div>
    );
  }

  const ringC = 2 * Math.PI * 34;

  return (
    <div className="space-y-5">
      {/* Facility hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0a1a33] via-[#0e2a52] to-[#0a3d3a] p-6 text-white shadow-xl shadow-slate-900/10 sm:p-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage: "linear-gradient(rgba(148,163,184,0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.13) 1px, transparent 1px)",
            backgroundSize: "34px 34px",
            maskImage: "radial-gradient(ellipse 85% 90% at 25% 15%, black 25%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse 85% 90% at 25% 15%, black 25%, transparent 75%)",
          }}
          aria-hidden="true"
        />
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-teal-400/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-indigo-500/25 blur-3xl" aria-hidden="true" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-2xl font-extrabold text-white shadow-lg ring-1 ring-white/25 ${user?.avatarColor ?? "from-teal-500 to-emerald-600"}`}>
              {initials}
            </span>
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-teal-300/30 bg-teal-400/15 px-2.5 py-0.5 text-[11px] font-bold text-teal-200">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute h-full w-full animate-ping rounded-full bg-teal-300 opacity-75" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-teal-300" />
                </span>
                LIVE FACILITY PULSE · {user?.code}
              </p>
              <h2 className="mt-2 truncate text-2xl font-extrabold tracking-tight sm:text-3xl">{currentHospitalName}</h2>
              <p className="mt-1 text-[13px] text-slate-300">
                {user?.role} · {user?.region} · {user?.bedCapacity} beds · {details.length} medicines tracked
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/forecast" className="inline-flex items-center gap-1.5 rounded-xl bg-teal-400 px-3.5 py-2 text-xs font-extrabold text-slate-950 shadow-lg shadow-teal-500/30 transition hover:bg-teal-300 active:scale-95">
                  <TrendingUp className="h-3.5 w-3.5" /> AI Forecast
                </Link>
                <Link to="/requests" className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-extrabold text-white backdrop-blur transition hover:bg-white/20 active:scale-95">
                  <Send className="h-3.5 w-3.5" /> Request Stock
                </Link>
              </div>
            </div>
          </div>

          {/* Supply health ring */}
          <div className="flex shrink-0 items-center gap-4 rounded-2xl border border-white/15 bg-white/[0.07] p-4 backdrop-blur-md">
            <div className="relative h-24 w-24">
              <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" role="img" aria-label={`Supply health ${safeShare} percent`}>
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="9" />
                <circle
                  cx="40" cy="40" r="34" fill="none"
                  stroke={safeShare >= 80 ? "#34d399" : safeShare >= 50 ? "#fbbf24" : "#fb7185"}
                  strokeWidth="9" strokeLinecap="round"
                  strokeDasharray={ringC} strokeDashoffset={ringC * (1 - safeShare / 100)}
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-extrabold">{safeShare}</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-300">health</span>
              </div>
            </div>
            <div className="space-y-1 text-xs">
              <p className="font-extrabold text-white">Supply Health</p>
              <p className="text-slate-300">{riskDist.find((d) => d.name === "Safe")?.value ?? 0} safe · {riskDist.find((d) => d.name === "Critical")?.value ?? 0} critical</p>
              <Link to="/shortage-risk" className="inline-flex items-center gap-1 font-bold text-teal-300 hover:text-teal-200">
                Risk radar <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* KPI cards */}
      <section aria-label="Key performance indicators">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {kpiCards.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.title}
                className={`group relative overflow-hidden rounded-2xl border bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-xl ${c.alert ? "border-rose-300 ring-1 ring-rose-200" : "border-slate-200/90"} ${c.glow}`}
              >
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${c.tile}`} aria-hidden="true" />
                <div className="flex items-start justify-between gap-3">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${c.tile} transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-3`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  {c.alert && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Urgent
                    </span>
                  )}
                </div>
                <p className="mt-3 text-[34px] font-extrabold leading-none tracking-tight text-slate-900">{c.value}</p>
                <p className="mt-1.5 text-sm font-bold text-slate-800">{c.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{c.hint}</p>
              </div>
            );
          })}
        </div>
      </section>

      <ForecastAlerts />

      {/* Charts row 1: demand trend + risk donut */}
      <section className="grid gap-4 xl:grid-cols-3" aria-label="Analytics">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
                <TrendingUp className="h-4 w-4 text-teal-600" />
                Demand trend{trend ? ` — ${trend.medicine}` : ""}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {trend ? "LightGBM forecast vs recent consumption · lowest-cover medicine" : "Fetching the LightGBM outlook for your lowest-cover medicine…"}
              </p>
            </div>
            <Link to="/forecast" className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:underline">
              Full forecast <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="mt-3 h-[260px]">
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <defs>
                    <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0d9488" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="predFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className={tooltipBox}>
                        <p className="font-bold text-slate-900">{label}</p>
                        {payload.map((p) => (
                          <p key={String(p.dataKey)} className="mt-0.5 font-semibold" style={{ color: p.color }}>
                            {p.dataKey === "actual" ? "Consumed" : "Predicted"}: {Number(p.value).toFixed(1)} units
                          </p>
                        ))}
                      </div>
                    );
                  }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="actual" name="Consumed" stroke="#0d9488" strokeWidth={2.5} fill="url(#actualFill)" connectNulls />
                  <Area type="monotone" dataKey="predicted" name="Predicted" stroke="#4f46e5" strokeWidth={2.5} strokeDasharray="6 4" fill="url(#predFill)" connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl bg-slate-50 text-xs font-semibold text-slate-400">
                Forecast unavailable — open the full forecast workspace.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-extrabold text-slate-900">Stockout risk mix</h3>
          <p className="mt-0.5 text-xs text-slate-500">Share of formulary by risk band</p>
          <div className="mx-auto mt-2 h-[190px] max-w-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={riskDist} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={3} strokeWidth={0}>
                  {riskDist.map((d) => (
                    <Cell key={d.name} fill={RISK_COLORS[d.name] ?? "#64748b"} />
                  ))}
                </Pie>
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { name: string; value: number };
                  return (
                    <div className={tooltipBox}>
                      <p className="font-bold text-slate-900">{d.name}</p>
                      <p className="text-slate-500">{d.value} medicines</p>
                    </div>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <Link to="/shortage-risk" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:underline">
            Open stockout prediction <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </section>

      {/* Charts row 2: cover bars + expiry + categories */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="More analytics">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-extrabold text-slate-900">Lowest days of cover</h3>
          <p className="mt-0.5 text-xs text-slate-500">Bar color = risk band</p>
          <div className="mt-2 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={coverData} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: "#334155", fontWeight: 600 }} tickLine={false} axisLine={false} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { medicine: string; days: number; level: string };
                  return (
                    <div className={tooltipBox}>
                      <p className="font-bold text-slate-900">{d.medicine}</p>
                      <p className="font-semibold" style={{ color: RISK_COLORS[d.level] }}>{d.days} days · {d.level}</p>
                    </div>
                  );
                }} />
                <Bar dataKey="days" radius={[0, 6, 6, 0]} barSize={14}>
                  {coverData.map((c) => (
                    <Cell key={c.medicine} fill={RISK_COLORS[c.level] ?? "#64748b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-extrabold text-slate-900">Expiring inventory</h3>
          <p className="mt-0.5 text-xs text-slate-500">Batches by time to expiry</p>
          <div className="mt-2 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={expiryBuckets} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} interval={0} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className={tooltipBox}>
                      <p className="font-bold text-slate-900">{label}</p>
                      <p className="font-semibold text-orange-600">{Number(payload[0].value)} batches</p>
                    </div>
                  );
                }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={38}>
                  {expiryBuckets.map((b, i) => (
                    <Cell key={b.name} fill={["#f43f5e", "#fb923c", "#facc15", "#10b981"][i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Link to="/expiry-risk" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:underline">
            Open expiry tracking <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm md:col-span-2 xl:col-span-1">
          <h3 className="text-sm font-extrabold text-slate-900">Stock by category</h3>
          <p className="mt-0.5 text-xs text-slate-500">Units on hand per therapeutic class</p>
          <div className="mt-3 space-y-2.5">
            {categoryData.length === 0 && (
              <p className="py-8 text-center text-xs text-slate-400">No category data available.</p>
            )}
            {categoryData.map((c, i) => {
              const max = categoryData[0]?.value ?? 1;
              return (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate font-bold text-slate-700">{c.name}</span>
                    <span className="ml-2 shrink-0 font-extrabold text-slate-900">{c.value.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(4, (c.value / max) * 100)}%`, background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* AI insights + activity */}
      <section className="grid gap-4 xl:grid-cols-5" aria-label="Intelligence and activity">
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-b from-indigo-50/70 to-white p-5 shadow-sm xl:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
              <BrainCircuit className="h-4.5 w-4.5" />
            </span>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">AI Supply Intelligence Insights</h3>
              <p className="text-[11px] text-slate-500">Generated from live backend signals — never invented</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {insights.length === 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-center">
                <PackageCheck className="mx-auto h-6 w-6 text-emerald-600" />
                <p className="mt-1 text-sm font-bold text-emerald-900">All clear — no urgent signals</p>
                <p className="text-xs text-emerald-700">The backend reports no critical, expiry, procurement or transfer signals right now.</p>
              </div>
            )}
            {insights.map((ins) => {
              const Icon = ins.icon;
              const tone = toneStyle[ins.tone];
              return (
                <div key={ins.title} className={`flex flex-col gap-3 rounded-2xl border p-4 transition hover:shadow-md sm:flex-row sm:items-center ${tone.ring}`}>
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone.tile}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-slate-900">{ins.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{ins.body}</p>
                  </div>
                  <Link
                    to={ins.to}
                    className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white shadow-sm transition active:scale-95 ${tone.btn}`}
                  >
                    {ins.action} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
              <History className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">Live supply signals</h3>
              <p className="text-[11px] text-slate-500">Backend alerts, orders & suggestions with real dates</p>
            </div>
          </div>
          <ol className="relative mt-4 space-y-1 border-l-2 border-slate-100 pl-0">
            {activity.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-400">No signals reported by the backend yet.</p>
            )}
            {activity.map((a) => {
              const Icon = a.icon;
              return (
                <li key={a.key} className="relative rounded-xl py-2 pl-5 pr-1 transition hover:bg-slate-50">
                  <span className="absolute -left-[7px] top-3.5 h-3 w-3 rounded-full border-2 border-white bg-teal-500 shadow" aria-hidden="true" />
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${a.tint}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-slate-800">{a.text}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">{a.sub}</p>
                    </div>
                    <Link to={a.to} className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900" aria-label={`Open related page for ${a.text}`}>
                      <Eye className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Smart inventory table */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm" aria-label="Smart inventory table">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">Smart inventory table</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {tableRows.length} of {details.length} medicines · click a column to sort
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:ml-auto">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition focus-within:border-teal-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500/15">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="sr-only">Search table</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search medicine or category…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 sm:w-52"
              />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Filter className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="sr-only">Filter by status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "All" | TableStatus)}
                className="bg-transparent text-sm font-semibold text-slate-700 outline-none"
              >
                {(["All", "Critical", "Low Stock", "Expiring Soon", "In Stock"] as const).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
                {([
                  { key: "medicine", label: "Medicine" },
                  { key: "total_quantity", label: "Available" },
                  { key: "days_of_supply", label: "Days of cover" },
                  { key: "expiry", label: "Nearest expiry" },
                ] as const).map((col) => (
                  <th key={col.key} className="px-5 py-3 font-extrabold">
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 uppercase hover:text-slate-900"
                      aria-label={`Sort by ${col.label}`}
                    >
                      {col.label}
                      <ArrowUpDown className={`h-3 w-3 ${sortKey === col.key ? "text-teal-600" : "text-slate-300"}`} />
                    </button>
                  </th>
                ))}
                <th className="px-5 py-3 font-extrabold">Status</th>
                <th className="px-5 py-3 font-extrabold">Recommended action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {pageRows.map((d) => {
                const status = tableStatus(d);
                const batch = nearestBatch(d);
                return (
                  <tr key={d.medicine_id} className="transition hover:bg-teal-50/40">
                    <td className="px-5 py-3">
                      <p className="font-bold text-slate-900">{d.medicine_name}</p>
                      <p className="text-[11px] text-slate-500">{d.category} · {d.unit}</p>
                    </td>
                    <td className="px-5 py-3 font-extrabold tabular-nums text-slate-900">
                      {d.total_quantity.toLocaleString()}
                      <span className="ml-1 text-[11px] font-medium text-slate-400">{d.unit}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-extrabold tabular-nums text-slate-900">{d.days_of_supply.toFixed(1)}d</span>
                      <span className="ml-2 text-[11px] text-slate-400">~{d.expected_daily_demand.toFixed(1)}/day</span>
                    </td>
                    <td className="px-5 py-3 text-xs font-semibold text-slate-600">
                      {batch ? (
                        <>
                          {batch.date}
                          <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${batch.days <= 14 ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-500"}`}>
                            {batch.days}d
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${STATUS_BADGE[status]}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Link to="/inventory" className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-slate-700" aria-label={`View details of ${d.medicine_name}`}>
                          <Eye className="h-3 w-3" /> View
                        </Link>
                        {(status === "Critical" || status === "Low Stock") && (
                          <Link to="/requests" className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-teal-700" aria-label={`Request stock of ${d.medicine_name}`}>
                            <Send className="h-3 w-3" /> Request
                          </Link>
                        )}
                        {(status === "Expiring Soon" || status === "Low Stock") && (
                          <Link to="/redistribution" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 transition hover:border-teal-300 hover:text-teal-700" aria-label={`Transfer stock of ${d.medicine_name}`}>
                            <Truck className="h-3 w-3" /> Transfer
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">
                    No medicines match this search and filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-xs font-semibold text-slate-500">
          <span>Page {page + 1} of {pageCount}</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 transition enabled:hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <button
              type="button"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 transition enabled:hover:bg-slate-50 disabled:opacity-40"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
