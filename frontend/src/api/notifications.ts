/** Network notification store: bell alerts whenever a hospital posts a request.
 * localStorage-backed (same-browser demo scope) with a tiny pub/sub so the
 * header bell updates live without polling. */

export interface AppNotification {
  id: string;
  hospital: string;
  medicine: string;
  quantity: number;
  urgency: string;
  requestId: string;
  createdAt: string; // ISO timestamp
  read: boolean;
}

const STORAGE_KEY = "medipulse_notifications";
const SEEDED_KEY = "medipulse_notifications_seeded";

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

export function subscribeNotifications(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function readAll(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppNotification[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: AppNotification[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    // storage unavailable — in-memory only
  }
  notify();
}

export function listNotifications(): AppNotification[] {
  return readAll();
}

export function unreadCount(): number {
  return readAll().filter((n) => !n.read).length;
}

export function pushNotification(n: Omit<AppNotification, "id" | "createdAt" | "read">): AppNotification[] {
  const item: AppNotification = {
    ...n,
    id: `notif-${Date.now()}`,
    createdAt: new Date().toISOString(),
    read: false,
  };
  const next = [item, ...readAll()];
  writeAll(next);
  return next;
}

export function markAllRead(): AppNotification[] {
  const next = readAll().map((n) => ({ ...n, read: true }));
  writeAll(next);
  return next;
}

/** One-time seed so the bell demonstrates with the 3 demo requests. */
export function seedFromRequests(
  requests: Array<{ id: string; hospital: string; medicine: string; quantity: number; urgency: string }>,
): void {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return;
    localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    return;
  }
  const items: AppNotification[] = requests.map((r, i) => ({
    id: `notif-seed-${r.id}`,
    hospital: r.hospital,
    medicine: r.medicine,
    quantity: r.quantity,
    urgency: r.urgency,
    requestId: r.id,
    createdAt: new Date(Date.now() - (i + 1) * 36e5).toISOString(),
    read: false,
  }));
  writeAll(items);
}

export function timeAgo(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 6e4));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
