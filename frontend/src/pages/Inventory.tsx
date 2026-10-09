import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowUpDown,
  Boxes,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  Search,
  Truck,
  X,
} from "lucide-react";
import { riskOf, type InventoryRow, type RiskLevel } from "../api/client";
import { getInventoryRows } from "../api/medpredict";
import { useAuth } from "../context/AuthContext";
import RiskBadge from "../components/RiskBadge";

const RISK_OPTIONS: Array<"All" | RiskLevel> = ["All", "Critical", "High", "Medium", "Safe"];
const STOCK_OPTIONS = ["All", "In stock", "Out of stock"] as const;

type SortKey = "hospital" | "medicine" | "current_quantity" | "avg_daily_usage" | "days_left" | "expiry_date";

function daysToExpiry(expiryDate: string): number {
  const ms = new Date(expiryDate).getTime() - Date.now();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function isCritical(row: InventoryRow): boolean {
  return String(row.criticality).toLowerCase() === "critical";
}

function formatDaysLeft(daysLeft: number | null): string {
  if (daysLeft == null || Number.isNaN(daysLeft)) return "n/a";
  if (!Number.isFinite(daysLeft)) return "no usage";
  return `${daysLeft.toFixed(1)}d`;
}

export default function Inventory() {
  const { user } = useAuth();
  const currentHospital = user?.name ?? "Hospital A";

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Search & Filters (search box can be pre-filled from the topbar via ?q=)
  const [searchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get("q") ?? "");
  const [medicine, setMedicine] = useState("All");
  const [risk, setRisk] = useState<"All" | RiskLevel>("All");
  const [maxDays, setMaxDays] = useState("");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [expiryRiskOnly, setExpiryRiskOnly] = useState(false);
  const [stockStatus, setStockStatus] = useState<(typeof STOCK_OPTIONS)[number]>("All");

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>("days_left");
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Expandable row state
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Simulation toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    getInventoryRows(user.id)
      .then((data) => setRows(data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q != null) setSearchTerm(q);
  }, [searchParams]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Strictly scoped to the authenticated organization
  const orgRows = useMemo(() => {
    return rows.filter((r) => r.hospital === currentHospital || r.hospital_id === user?.id);
  }, [rows, currentHospital, user]);

  const medicines = useMemo(
    () => ["All", ...Array.from(new Set(orgRows.map((r) => r.medicine))).sort()],
    [orgRows],
  );

  const filtered = useMemo(() => {
    const max = maxDays.trim() === "" ? null : Number(maxDays);
    const searchLower = searchTerm.toLowerCase().trim();

    return orgRows.filter((r) => {
      if (searchLower) {
        const matchesName = r.medicine.toLowerCase().includes(searchLower);
        const matchesSupplier = r.supplier.toLowerCase().includes(searchLower);
        if (!matchesName && !matchesSupplier) return false;
      }
      if (medicine !== "All" && r.medicine !== medicine) return false;
      if (risk !== "All" && riskOf(r.days_left) !== risk) return false;
      if (max != null && !(r.days_left != null && r.days_left < max)) return false;
      if (criticalOnly && !isCritical(r)) return false;
      if (expiryRiskOnly && !(daysToExpiry(r.expiry_date) <= 14)) return false;
      if (stockStatus === "In stock" && !(r.current_quantity > 0)) return false;
      if (stockStatus === "Out of stock" && !(r.current_quantity <= 0)) return false;
      return true;
    });
  }, [orgRows, searchTerm, medicine, risk, maxDays, criticalOnly, expiryRiskOnly, stockStatus]);

  // Sorted list
  const sortedRows = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let valA = a[sortKey];
      let valB = b[sortKey];

      if (valA == null) valA = sortAsc ? 999999 : -999999;
      if (valB == null) valB = sortAsc ? 999999 : -999999;

      if (typeof valA === "string" && typeof valB === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });
  }, [filtered, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const resetFilters = () => {
    setSearchTerm("");
    setMedicine("All");
    setRisk("All");
    setMaxDays("");
    setCriticalOnly(false);
    setExpiryRiskOnly(false);
    setStockStatus("All");
  };

  const hasActiveFilters =
    searchTerm !== "" ||
    medicine !== "All" ||
    risk !== "All" ||
    maxDays !== "" ||
    criticalOnly ||
    expiryRiskOnly ||
    stockStatus !== "All";

  // Reactive CSV export
  const exportCSV = () => {
    const headers = [
      "Hospital",
      "Medicine",
      "Current Stock",
      "Avg Daily Demand",
      "Days Left",
      "Risk Level",
      "Supplier",
      "Lead Time (Days)",
      "Expiry Date",
      "Critical Supply",
      "Alternative Available",
    ];

    const csvLines = [headers.join(",")];
    for (const r of sortedRows) {
      csvLines.push(
        [
          `"${r.hospital}"`,
          `"${r.medicine}"`,
          r.current_quantity,
          r.avg_daily_usage,
          r.days_left ?? "",
          `"${riskOf(r.days_left)}"`,
          `"${r.supplier}"`,
          r.supplier_lead_time_days,
          `"${r.expiry_date}"`,
          isCritical(r) ? "Yes" : "No",
          r.alternative_available ? "Yes" : "No",
        ].join(","),
      );
    }

    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `medipulse_inventory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${sortedRows.length} inventory records to CSV.`);
  };

  // Quick stat counts for current organization
  const criticalCount = orgRows.filter((r) => riskOf(r.days_left) === "Critical").length;
  const highRiskCount = orgRows.filter((r) => riskOf(r.days_left) === "High").length;
  const expiringCount = orgRows.filter((r) => daysToExpiry(r.expiry_date) <= 14).length;
  const stockoutCount = orgRows.filter((r) => r.current_quantity <= 0).length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
          <p className="text-sm font-semibold">Loading real-time inventory records…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-6 text-rose-900 shadow-sm">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-rose-600" />
          <div>
            <h3 className="font-bold">Could not load live inventory</h3>
            <p className="text-xs text-rose-700 mt-1">{error} — verify the API at http://localhost:8000 is running.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-semibold text-white shadow-xl animate-bounce">
          <CheckCircle className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header & Stat Chips */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              {currentHospital} — Formulary Stock Telemetry
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Real-time formulary stock levels, consumption run-rates, and expiration countdowns for {currentHospital}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-95 transition-all"
          >
            <Download className="h-3.5 w-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Quick Reactive Filter Pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setRisk("All");
            setCriticalOnly(false);
            setExpiryRiskOnly(false);
            setStockStatus("All");
          }}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
            risk === "All" && !criticalOnly && !expiryRiskOnly && stockStatus === "All"
              ? "bg-indigo-600 text-white shadow-sm"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          All Items ({rows.length})
        </button>

        <button
          onClick={() => {
            setRisk("Critical");
            setCriticalOnly(false);
            setExpiryRiskOnly(false);
          }}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
            risk === "Critical"
              ? "bg-rose-600 text-white shadow-sm shadow-rose-600/30"
              : "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
          }`}
        >
          🚨 Critical Shortages ({criticalCount})
        </button>

        <button
          onClick={() => {
            setRisk("High");
            setCriticalOnly(false);
            setExpiryRiskOnly(false);
          }}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
            risk === "High"
              ? "bg-amber-600 text-white shadow-sm shadow-amber-600/30"
              : "bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
          }`}
        >
          ⚠️ High Risk ({highRiskCount})
        </button>

        <button
          onClick={() => {
            setExpiryRiskOnly(true);
            setRisk("All");
          }}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
            expiryRiskOnly
              ? "bg-orange-600 text-white shadow-sm shadow-orange-600/30"
              : "bg-orange-50 text-orange-800 border border-orange-200 hover:bg-orange-100"
          }`}
        >
          ⏳ Expiring Soon ({expiringCount})
        </button>

        <button
          onClick={() => {
            setStockStatus("Out of stock");
            setRisk("All");
          }}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
            stockStatus === "Out of stock"
              ? "bg-slate-900 text-white shadow-sm"
              : "bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200"
          }`}
        >
          📦 Zero Stock ({stockoutCount})
        </button>
      </div>

      {/* Main Interactive Filter Bar */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Instant Search Bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Instant search by medicine, hospital, or supplier..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-8 py-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Active record counter & reset */}
          <div className="flex items-center justify-between lg:justify-end gap-3 text-xs">
            <span className="font-medium text-slate-500">
              Showing <span className="font-bold text-slate-900">{sortedRows.length}</span> of {rows.length} records
            </span>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
              >
                <X className="h-3 w-3" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Multi-dropdown filter row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Facility Scope</label>
            <div
              className="w-full rounded-lg border border-indigo-200 bg-indigo-50/70 px-2 py-1.5 font-bold text-indigo-900 truncate text-xs"
              title={currentHospital}
            >
              {currentHospital}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Medicine</label>
            <select
              className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5 font-medium text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none transition-colors"
              value={medicine}
              onChange={(e) => setMedicine(e.target.value)}
            >
              {medicines.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Risk Band</label>
            <select
              className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5 font-medium text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none transition-colors"
              value={risk}
              onChange={(e) => setRisk(e.target.value as "All" | RiskLevel)}
            >
              {RISK_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Stock Status</label>
            <select
              className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5 font-medium text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none transition-colors"
              value={stockStatus}
              onChange={(e) => setStockStatus(e.target.value as (typeof STOCK_OPTIONS)[number])}
            >
              {STOCK_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Days Left &lt;</label>
            <input
              type="number"
              min={0}
              placeholder="e.g. 7"
              value={maxDays}
              onChange={(e) => setMaxDays(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5 font-medium text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none transition-colors"
            />
          </div>

          <div className="flex flex-col justify-end gap-1 pb-1">
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={criticalOnly}
                onChange={(e) => setCriticalOnly(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>Critical Only</span>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={expiryRiskOnly}
                onChange={(e) => setExpiryRiskOnly(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>Expires ≤ 14d</span>
            </label>
          </div>
        </div>
      </div>

      {/* Reactive Sortable Table with Expandable Rows */}
      {sortedRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <Boxes className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-3 text-sm font-bold text-slate-800">No inventory matches your filters</h3>
          <p className="mt-1 text-xs text-slate-500">Try loosening your search terms or risk band selection.</p>
          <button
            onClick={resetFilters}
            className="mt-4 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <thead className="bg-slate-50/80 text-slate-600">
                <tr>
                  <th
                    onClick={() => handleSort("hospital")}
                    className="cursor-pointer px-4 py-3 text-left font-bold hover:text-slate-900 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Hospital</span>
                      <ArrowUpDown className="h-3 w-3 text-slate-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("medicine")}
                    className="cursor-pointer px-4 py-3 text-left font-bold hover:text-slate-900 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Medicine</span>
                      <ArrowUpDown className="h-3 w-3 text-slate-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("current_quantity")}
                    className="cursor-pointer px-4 py-3 text-right font-bold hover:text-slate-900 transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Stock Units</span>
                      <ArrowUpDown className="h-3 w-3 text-slate-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("avg_daily_usage")}
                    className="cursor-pointer px-4 py-3 text-right font-bold hover:text-slate-900 transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Daily Burn</span>
                      <ArrowUpDown className="h-3 w-3 text-slate-400" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("days_left")}
                    className="cursor-pointer px-4 py-3 text-left font-bold hover:text-slate-900 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Days of Supply</span>
                      <ArrowUpDown className="h-3 w-3 text-slate-400" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left font-bold">Risk Status</th>
                  <th className="px-3 py-3 text-center font-bold">Drilldown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRows.map((r) => {
                  const rowId = `${r.hospital_id}-${r.medicine_id}`;
                  const isExpanded = expandedRowId === rowId;
                  const level = riskOf(r.days_left);
                  const days = r.days_left ?? 0;
                  const dte = daysToExpiry(r.expiry_date);
                  const isShortageCritical = level === "Critical";

                  // Gauge percentage for Days Left (capped at 30 days = 100%)
                  const progressPct = Math.min(100, Math.max(5, (days / 20) * 100));

                  return (
                    <tr
                      key={rowId}
                      className={`group transition-colors ${
                        isShortageCritical
                          ? "bg-rose-50/30 hover:bg-rose-50/60"
                          : isExpanded
                          ? "bg-indigo-50/40"
                          : "hover:bg-slate-50/80"
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {r.hospital}
                      </td>

                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span>{r.medicine}</span>
                          {isCritical(r) && (
                            <span className="rounded bg-rose-600 px-1.5 py-0.2 text-[9px] font-extrabold uppercase text-white shadow-xs">
                              Essential
                            </span>
                          )}
                        </div>
                        {dte <= 14 && (
                          <span className="text-[10px] text-amber-700 font-medium">
                            Expires in {dte}d
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                        {r.current_quantity.toLocaleString()}
                      </td>

                      <td className="px-4 py-3 text-right font-mono text-slate-600">
                        {r.avg_daily_usage.toFixed(1)} /d
                      </td>

                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span
                              className={
                                isShortageCritical
                                  ? "text-rose-700"
                                  : level === "High"
                                  ? "text-amber-700"
                                  : "text-slate-800"
                              }
                            >
                              {formatDaysLeft(r.days_left)}
                            </span>
                          </div>
                          {/* Visual progress bar */}
                          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isShortageCritical
                                  ? "bg-rose-600"
                                  : level === "High"
                                  ? "bg-amber-500"
                                  : level === "Medium"
                                  ? "bg-yellow-500"
                                  : "bg-emerald-500"
                              }`}
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <RiskBadge level={level} size="sm" />
                      </td>

                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => setExpandedRowId(isExpanded ? null : rowId)}
                          className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                          title="Click to view full supply chain telemetry"
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Drilldown Drawer for Expanded Row */}
          {expandedRowId && (
            <div className="border-t border-indigo-100 bg-gradient-to-r from-slate-50 via-indigo-50/30 to-slate-50 p-5">
              {(() => {
                const r = rows.find((item) => `${item.hospital_id}-${item.medicine_id}` === expandedRowId);
                if (!r) return null;
                const dte = daysToExpiry(r.expiry_date);
                const leadCovered = (r.days_left ?? 0) >= r.supplier_lead_time_days;

                return (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-200 pb-2">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                          Supply Chain Diagnostic
                        </span>
                        <h4 className="text-sm font-bold text-slate-900">
                          {r.medicine} @ {r.hospital}
                        </h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          to="/redistribution"
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
                        >
                          <Truck className="h-3.5 w-3.5" />
                          <span>Plan Redistribution</span>
                        </Link>
                        <button
                          onClick={() => showToast(`Emergency procurement alert logged for ${r.supplier}.`)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          Log Supplier Order
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                        <span className="text-[11px] font-semibold text-slate-500">Contracted Supplier</span>
                        <p className="font-bold text-slate-900 mt-0.5">{r.supplier}</p>
                        <p className="text-[11px] text-slate-500">
                          Lead time: <span className="font-semibold text-slate-700">{r.supplier_lead_time_days} days</span>
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                        <span className="text-[11px] font-semibold text-slate-500">Procurement Feasibility</span>
                        <p className={`font-bold mt-0.5 ${leadCovered ? "text-emerald-700" : "text-rose-700"}`}>
                          {leadCovered ? "Safe (Lead time covered)" : "Breached (Stockout before delivery)"}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {leadCovered
                            ? "Standard reorder will arrive in time."
                            : "Supplier cannot replenish in time. Immediate redistribution required."}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                        <span className="text-[11px] font-semibold text-slate-500">Lot Expiry Date</span>
                        <p className="font-bold text-slate-900 mt-0.5">{r.expiry_date}</p>
                        <p className={`text-[11px] font-semibold ${dte <= 14 ? "text-amber-700" : "text-slate-500"}`}>
                          {dte > 0 ? `${dte} days remaining` : "Expired batch"}
                        </p>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                        <span className="text-[11px] font-semibold text-slate-500">Clinical Alternatives</span>
                        <p className="font-bold text-slate-900 mt-0.5">
                          {r.alternative_available ? "Alternative stocked" : "No alternative available"}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {r.alternative_available
                            ? "Physicians can substitute peer SKU if stock drops."
                            : "Critical care risk if stock reaches zero."}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
