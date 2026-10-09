import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import {
  listNotifications,
  markAllRead,
  subscribeNotifications,
  timeAgo,
  unreadCount,
  type AppNotification,
} from "../api/notifications";

/** Header bell: unread badge + dropdown of hospital request alerts. */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>(() => listNotifications());
  const [unread, setUnread] = useState(() => unreadCount());

  useEffect(() => {
    const refresh = () => {
      setItems(listNotifications());
      setUnread(unreadCount());
    };
    refresh();
    return subscribeNotifications(refresh);
  }, []);

  function toggle() {
    if (!open) {
      setItems(markAllRead());
      setUnread(0);
    }
    setOpen((v) => !v);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        className="relative rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-xl">
            <p className="border-b border-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              Hospital requests
            </p>
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                No request alerts yet.
              </p>
            ) : (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {items.map((n) => (
                  <li key={n.id}>
                    <Link
                      to="/requests"
                      onClick={() => setOpen(false)}
                      className="block px-4 py-2.5 hover:bg-slate-50"
                    >
                      <p className="text-sm">
                        <strong>{n.hospital}</strong> requested{" "}
                        <strong>{n.quantity.toLocaleString()} units</strong> of {n.medicine}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {n.urgency} urgency · {timeAgo(n.createdAt)}
                        {!n.read && <span className="ml-1 font-bold text-indigo-600">· New</span>}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
