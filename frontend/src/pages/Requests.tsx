import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Building2,
  CircleCheck,
  Clock,
  HeartHandshake,
  IndianRupee,
  MapPin,
  Navigation,
  Package,
  Sparkles,
  Truck,
  X,
} from "lucide-react";
import {
  DEMO_OFFERS,
  DEMO_REQUESTS,
  fillerRoute,
  type DemoOffer,
  type DemoRequest,
  type RequestStatus,
  type RequestUrgency,
} from "../api/mockData";
import { getMedicines } from "../api/forecast";
import { pushNotification, seedFromRequests } from "../api/notifications";
import { useAuth } from "../context/AuthContext";
import DemoBadge from "../components/DemoBadge";
import OfferMap from "../components/OfferMap";

const URGENCIES: RequestUrgency[] = ["Low", "Normal", "High"];
const STATUSES: Array<"All" | RequestStatus> = ["All", "Pending", "Approved", "Fulfilled"];

const URGENCY_STYLES: Record<RequestUrgency, string> = {
  Low: "bg-gray-100 text-gray-700 border-gray-300",
  Normal: "bg-green-100 text-green-800 border-green-300",
  High: "bg-orange-100 text-orange-800 border-orange-300",
};

const STATUS_STYLES: Record<RequestStatus, string> = {
  Pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
  Approved: "bg-blue-100 text-blue-800 border-blue-300",
  Fulfilled: "bg-green-100 text-green-800 border-green-300",
};

const FALLBACK_MEDICINES = Array.from(new Set(DEMO_REQUESTS.map((r) => r.medicine))).sort();

const inputCls = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

/** Best offer first: ready now beats waiting; among ready donors the fastest
 * route wins (traffic-aware); then larger quantity. */
function sortOffers(offers: DemoOffer[]): DemoOffer[] {
  return [...offers].sort((a, b) => {
    if (a.canTransportImmediately !== b.canTransportImmediately) {
      return a.canTransportImmediately ? -1 : 1;
    }
    if (a.canTransportImmediately && b.canTransportImmediately && a.travelMinutes !== b.travelMinutes) {
      return a.travelMinutes - b.travelMinutes;
    }
    if (!a.canTransportImmediately && !b.canTransportImmediately && (a.etaHours ?? 999) !== (b.etaHours ?? 999)) {
      return (a.etaHours ?? 999) - (b.etaHours ?? 999);
    }
    return b.quantity - a.quantity;
  });
}

function transportLabel(o: DemoOffer): string {
  const route = `${o.distanceKm}km · ${o.travelMinutes}min · ${o.traffic} traffic`;
  if (o.canTransportImmediately) return `Immediate transport (${route})`;
  return o.etaHours != null ? `Pickup needed, ~${o.etaHours}h (${route})` : `Pickup needed (${route})`;
}

function formatCost(cost: number | null): string {
  if (cost == null) return "Cost not shared";
  if (cost === 0) return "Free donation";
  return `₹${cost.toLocaleString("en-IN")}`;
}

/** Requests page: network board + click-through detail with grant/help offers. */
export default function Requests() {
  const { user } = useAuth();
  const requester = user?.name ?? "Hospital A";
  const [requests, setRequests] = useState<DemoRequest[]>(DEMO_REQUESTS);
  const [offers, setOffers] = useState<DemoOffer[]>(DEMO_OFFERS);
  const [urgencyFilter, setUrgencyFilter] = useState<"All" | RequestUrgency>("All");
  const [statusFilter, setStatusFilter] = useState<"All" | RequestStatus>("All");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Medicine options come from the live dataset; fall back to the demo list if offline.
  const [medicines, setMedicines] = useState<string[]>(FALLBACK_MEDICINES);

  const [medicine, setMedicine] = useState(FALLBACK_MEDICINES[0]);
  const [quantity, setQuantity] = useState("");
  const [urgency, setUrgency] = useState<RequestUrgency>("Normal");
  const [formError, setFormError] = useState<string | null>(null);

  // Offer form state (inside the detail modal, behind the Grant Help button).
  const [offerFormOpen, setOfferFormOpen] = useState(false);
  const [offerQty, setOfferQty] = useState("");
  const [offerCost, setOfferCost] = useState("");
  const [offerTransport, setOfferTransport] = useState(false);
  const [offerEta, setOfferEta] = useState("");
  const [offerError, setOfferError] = useState<string | null>(null);

  useEffect(() => {
    seedFromRequests(
      DEMO_REQUESTS.map((r) => ({
        id: r.id,
        hospital: r.hospital,
        medicine: r.medicine,
        quantity: r.quantity,
        urgency: r.urgency,
      })),
    );
    getMedicines()
      .then((medicineOptions) => {
        if (medicineOptions.length) {
          const names = medicineOptions.map((m) => m.name);
          setMedicines(names);
          setMedicine((current) => (names.includes(current) ? current : names[0]));
        }
      })
      .catch(() => {
        // Offline — keep the demo-derived selector options.
      });
  }, []);

  const filtered = useMemo(
    () =>
      requests.filter(
        (r) =>
          (urgencyFilter === "All" || r.urgency === urgencyFilter) &&
          (statusFilter === "All" || r.status === statusFilter),
      ),
    [requests, urgencyFilter, statusFilter],
  );

  const pendingCount = requests.filter((r) => r.status === "Pending").length;
  const selected = requests.find((r) => r.id === selectedId) ?? null;
  const selectedOffers = useMemo(
    () => (selected ? sortOffers(offers.filter((o) => o.requestId === selected.id)) : []),
    [offers, selected],
  );
  const offeredQty = selectedOffers.reduce((s, o) => s + o.quantity, 0);

  function openDetail(id: string) {
    setSelectedId(id);
    setOfferFormOpen(false);
    setOfferQty("");
    setOfferCost("");
    setOfferTransport(false);
    setOfferEta("");
    setOfferError(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!medicine) {
      setFormError("Choose a medicine.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError("Quantity must be a positive number.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const newId = `req-${Date.now()}`;
    setRequests((prev) => [
      {
        id: newId,
        hospital: requester,
        medicine,
        quantity: Math.floor(qty),
        urgency,
        status: "Pending",
        date: today,
        note: "Posted to the network board",
      },
      ...prev,
    ]);
    pushNotification({
      hospital: requester,
      medicine,
      quantity: Math.floor(qty),
      urgency,
      requestId: newId,
    });
    setQuantity("");
    setUrgency("Normal");
    setFormError(null);
    setFormOpen(false);
  }

  function submitOffer(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const qty = Number(offerQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setOfferError("Quantity must be a positive number.");
      return;
    }
    const cost = Number(offerCost);
    if (!Number.isFinite(cost) || cost < 0) {
      setOfferError("Enter the estimated cost in ₹ (0 if it is a free donation).");
      return;
    }
    const eta = offerTransport ? 1 : Number(offerEta);
    if (!offerTransport && (!Number.isFinite(eta) || eta <= 0)) {
      setOfferError("Enter when transport can reach (hours), or tick immediate transport.");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const route = fillerRoute(requester, selected.id);
    setOffers((prev) => [
      {
        id: `off-${Date.now()}`,
        requestId: selected.id,
        donor: requester,
        quantity: Math.floor(qty),
        canTransportImmediately: offerTransport,
        etaHours: Math.floor(eta),
        distanceKm: route.distanceKm,
        traffic: route.traffic,
        travelMinutes: route.travelMinutes,
        estimatedCost: Math.round(cost),
        date: today,
        note: offerTransport ? "Vehicle ready now" : "Needs pickup arrangement",
      },
      ...prev,
    ]);
    setOfferQty("");
    setOfferCost("");
    setOfferTransport(false);
    setOfferEta("");
    setOfferError(null);
    setOfferFormOpen(false);
  }

  const coveragePct = selected ? Math.min(100, Math.round((offeredQty / selected.quantity) * 100)) : 0;
  const totalCost = selectedOffers.reduce((s, o) => s + (o.estimatedCost ?? 0), 0);
  const hasAnyCost = selectedOffers.some((o) => o.estimatedCost != null);

  return (
    <div className="pb-20">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-semibold">Network Requirements</h2>
          <DemoBadge />
        </div>
        <p className="text-sm text-gray-600">
          {pendingCount} pending · {filtered.length} shown
        </p>
      </div>
      <p className="mb-4 text-sm text-gray-600">
        Non-urgent needs posted across the network. Click a request to see offers and grant help.
      </p>

      <div className="mb-4 flex flex-wrap gap-3 rounded border border-gray-200 bg-gray-50 p-3">
        <label className="flex items-center gap-1 text-sm">
          Urgency{" "}
          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value as "All" | RequestUrgency)}
          >
            {["All", ...URGENCIES].map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">
          Status{" "}
          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "All" | RequestStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded border border-gray-200 bg-white p-6 text-center text-gray-600">
          No requirements match these filters.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((r) => {
            const count = offers.filter((o) => o.requestId === r.id).length;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => openDetail(r.id)}
                className="rounded border border-gray-200 bg-white p-4 text-left hover:border-gray-400 hover:shadow"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{r.hospital}</h3>
                  <div className="flex gap-1">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${URGENCY_STYLES[r.urgency]}`}>
                      {r.urgency} urgency
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status]}`}>
                      {r.status}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-sm">
                  <span className="font-semibold">{r.quantity.toLocaleString()} units</span> of {r.medicine}
                </p>
                <p className="mt-1 text-sm text-gray-600">{r.note}</p>
                <p className="mt-1 text-xs text-gray-400">
                  Requested {r.date} · {count} offer{count === 1 ? "" : "s"} · Click to view and help
                </p>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-3 backdrop-blur-sm sm:p-4 lg:p-6" onClick={() => setSelectedId(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="m-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
          >
            {/* Header */}
            <div className="flex shrink-0 flex-wrap items-start gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
                <Building2 size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-900">
                    {selected.hospital} <span className="font-medium text-slate-400">needs</span> {selected.medicine}
                  </h3>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${URGENCY_STYLES[selected.urgency]}`}>
                    {selected.urgency}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[selected.status]}`}>
                    {selected.status}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-1"><Package size={14} /> {selected.quantity.toLocaleString()} units needed</span>
                  <span className="inline-flex items-center gap-1"><Clock size={14} /> Requested {selected.date}</span>
                </p>
                {selected.note && <p className="mt-1 text-sm text-slate-600">{selected.note}</p>}
                {/* Coverage progress */}
                <div className="mt-2 flex max-w-md items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all ${offeredQty >= selected.quantity ? "bg-green-600" : "bg-slate-900"}`}
                      style={{ width: `${coveragePct}%` }}
                    />
                  </div>
                  <span className="whitespace-nowrap text-xs font-semibold text-slate-700">
                    {offeredQty.toLocaleString()} / {selected.quantity.toLocaleString()} · {coveragePct}%
                  </span>
                  {offeredQty >= selected.quantity && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                      <CircleCheck size={12} /> Fully covered
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Close details"
                className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body: map left, offers right */}
            <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 sm:gap-4 sm:p-4 lg:grid-cols-[1.05fr_1fr] lg:overflow-hidden lg:p-5">
              {/* Left: geomap */}
              <section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 lg:overflow-y-auto">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900">
                    <MapPin size={16} /> Donor routes
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                    <Sparkles size={11} /> Traffic-aware
                  </span>
                  <span className="ml-auto text-xs text-slate-400">{selectedOffers.length} route{selectedOffers.length === 1 ? "" : "s"}</span>
                </div>
                <div className="min-w-0 shrink-0">
                  <OfferMap requester={selected.hospital} offers={selectedOffers} />
                </div>
                <p className="mt-2 shrink-0 text-[11px] text-slate-400">Locations and traffic are filler data until the routing API lands.</p>
              </section>

              {/* Right: offers + grant help */}
              <section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 lg:overflow-hidden">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900">Offers ({selectedOffers.length})</h4>
                  {hasAnyCost && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                      <IndianRupee size={12} /> {totalCost.toLocaleString("en-IN")} total est.
                    </span>
                  )}
                  {selected.hospital !== requester && (
                    <button
                      type="button"
                      onClick={() => { setOfferFormOpen((v) => !v); setOfferError(null); }}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-slate-700"
                    >
                      <HeartHandshake size={16} /> {offerFormOpen ? "Close form" : "Grant help"}
                    </button>
                  )}
                </div>

                {selected.hospital === requester ? (
                  <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
                    This is your facility's request — other hospitals will offer help here.
                  </p>
                ) : (
                  offerFormOpen && (
                    <form onSubmit={submitOffer} className="mb-3 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-200">
                        <span className="text-slate-500">Donating as </span>
                        <span className="font-semibold text-slate-900">{requester}</span>
                      </div>
                      <label className="block text-sm font-medium text-slate-700">
                        Quantity you can provide (units)
                        <input
                          className={`${inputCls} mt-1`}
                          type="number"
                          min={1}
                          placeholder="e.g. 500"
                          value={offerQty}
                          onChange={(e) => setOfferQty(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-700">
                        Estimated cost (₹)
                        <input
                          className={`${inputCls} mt-1`}
                          type="number"
                          min={0}
                          placeholder="e.g. 4500 (0 if free)"
                          value={offerCost}
                          onChange={(e) => setOfferCost(e.target.value)}
                        />
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-sm ring-1 ring-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-slate-900"
                          checked={offerTransport}
                          onChange={(e) => setOfferTransport(e.target.checked)}
                        />
                        <Truck size={15} className="text-slate-500" /> We can transport it immediately
                      </label>
                      {!offerTransport && (
                        <label className="block text-sm font-medium text-slate-700">
                          Transport reachable in (hours)
                          <input
                            className={`${inputCls} mt-1`}
                            type="number"
                            min={1}
                            placeholder="e.g. 6"
                            value={offerEta}
                            onChange={(e) => setOfferEta(e.target.value)}
                          />
                        </label>
                      )}
                      {offerError && <p className="text-sm font-medium text-red-700">{offerError}</p>}
                      <button type="submit" className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700">
                        Send offer
                      </button>
                    </form>
                  )
                )}

                <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 lg:pr-1">
                  {selectedOffers.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                      <p className="text-sm font-semibold text-slate-800">No offers yet</p>
                      <p className="mt-1 text-sm text-slate-500">Be the first to help this facility.</p>
                      {selected.hospital !== requester && !offerFormOpen && (
                        <button
                          type="button"
                          onClick={() => setOfferFormOpen(true)}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                        >
                          <HeartHandshake size={16} /> Grant help
                        </button>
                      )}
                    </div>
                  ) : (
                    <ul className="space-y-2.5">
                      {selectedOffers.map((o, i) => (
                        <li key={o.id} className={`rounded-xl border p-3.5 transition hover:shadow-md ${i === 0 && o.canTransportImmediately ? "border-green-300 bg-green-50/50" : "border-slate-200 bg-white"}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                              {o.donor.charAt(0)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold text-slate-900">{o.donor}</p>
                              <p className="text-xs text-slate-400">Offered {o.date}</p>
                            </div>
                            <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">
                              {o.quantity.toLocaleString()} units
                            </span>
                          </div>
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                              <IndianRupee size={12} /> {formatCost(o.estimatedCost)}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                                o.canTransportImmediately
                                  ? "border-green-300 bg-green-100 text-green-800"
                                  : "border-amber-300 bg-amber-100 text-amber-800"
                              }`}
                            >
                              <Truck size={12} /> {transportLabel(o)}
                            </span>
                          </div>
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1"><Navigation size={12} /> {o.distanceKm} km</span>
                            <span className="inline-flex items-center gap-1"><Clock size={12} /> {o.travelMinutes} min</span>
                            <span className="capitalize">{o.traffic} traffic</span>
                            <span className="text-slate-400">· {o.note}</span>
                          </p>
                          {i === 0 && o.canTransportImmediately && (
                            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-bold text-white">
                              <Sparkles size={11} /> Suggested — fastest route
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {!formOpen ? (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="fixed bottom-6 right-6 rounded-full bg-gray-900 px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-gray-700"
        >
          + Post Requirement
        </button>
      ) : (
        <div className="fixed inset-0 z-50 flex items-end justify-end overflow-y-auto bg-slate-950/50 p-3 backdrop-blur-sm sm:p-4" onClick={() => setFormOpen(false)}>
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
          >
            <h3 className="mb-3 font-semibold">Post a requirement</h3>
            <div className="space-y-2">
              <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-sm">
                <span className="text-gray-500">Requesting facility: </span>
                <span className="font-semibold text-gray-800">{requester}</span>
              </div>
              <label className="block text-sm">
                Medicine needed
                <select className={inputCls} value={medicine} onChange={(e) => setMedicine(e.target.value)}>
                  {medicines.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Quantity (units)
                <input
                  className={inputCls}
                  type="number"
                  min={1}
                  placeholder="e.g. 1000"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Urgency
                <select className={inputCls} value={urgency} onChange={(e) => setUrgency(e.target.value as RequestUrgency)}>
                  {URGENCIES.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </label>
              {formError && <p className="text-sm text-red-700">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button type="submit" className="rounded bg-gray-900 px-3 py-1 text-sm font-semibold text-white hover:bg-gray-700">
                  Post requirement
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
