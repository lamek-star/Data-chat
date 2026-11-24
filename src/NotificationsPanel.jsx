import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, BellOff, MessageCircle, Smartphone, Volume2, Vibrate, X } from "lucide-react";
import { alertPrefs, messagePreview, requestSystemPermission, setAlertPrefs, systemPermission } from "./notify";

/**
 * The bell: conversations with unread messages, recent account notices, and
 * the member's alert settings (sound, vibration, phone/browser notifications).
 */
export function NotificationsPanel({ contacts, unreadCounts, last, notifications, openChat, close }) {
  const [prefs, setPrefs] = useState(alertPrefs);
  const [permission, setPermission] = useState("default");
  useEffect(() => {
    systemPermission().then(setPermission);
  }, []);
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const unread = contacts
    .filter((c) => unreadCounts[c.id])
    .sort((a, b) => (last[b.id]?.order ?? 0) - (last[a.id]?.order ?? 0));
  const notices = [...notifications].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
  const toggle = (key) => setPrefs(setAlertPrefs({ [key]: !prefs[key] }));
  const enableSystem = async () => {
    const result = await requestSystemPermission();
    setPermission(result);
    if (result === "granted") setPrefs(setAlertPrefs({ system: true }));
  };

  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="modal notifications-panel" role="dialog" aria-modal="true" aria-labelledby="alerts-title">
        <div className="modal-head">
          <h2 id="alerts-title">Notifications</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        <h3 className="alerts-heading">New messages</h3>
        {unread.length ? (
          <div className="alerts-list">
            {unread.map((c) => (
              <button key={c.id} type="button" onClick={() => openChat(c.id)}>
                <MessageCircle size={18} strokeWidth={1.8} />
                <span>
                  <b>{c.name}</b>
                  <small>{messagePreview(last[c.id]?.message)}</small>
                </span>
                <em className="unread-badge">{unreadCounts[c.id]}</em>
              </button>
            ))}
          </div>
        ) : (
          <p className="alerts-empty">You're all caught up.</p>
        )}

        {notices.length > 0 && (
          <>
            <h3 className="alerts-heading">Account</h3>
            <ul className="alerts-notices">
              {notices.map((n) => (
                <li key={n.id}>
                  <Bell size={15} strokeWidth={1.8} />
                  <span>{n.text}</span>
                  {n.date && <small>{new Date(n.date).toLocaleDateString()}</small>}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="alerts-heading">Alerts</h3>
        <div className="alerts-settings">
          <label>
            <Volume2 size={17} strokeWidth={1.8} />
            <span>Sound for new messages</span>
            <input type="checkbox" checked={prefs.sound} onChange={() => toggle("sound")} />
          </label>
          <label>
            <Vibrate size={17} strokeWidth={1.8} />
            <span>Vibrate (phones)</span>
            <input type="checkbox" checked={prefs.vibrate} onChange={() => toggle("vibrate")} />
          </label>
          <div className="alerts-system">
            <Smartphone size={17} strokeWidth={1.8} />
            <span>
              <b>Notifications when DataChat is in the background</b>
              <small>
                {permission === "granted"
                  ? "On. You'll be notified while DataChat is open in the background."
                  : permission === "denied"
                    ? "Blocked. Allow notifications for DataChat in your phone or browser settings."
                    : permission === "unsupported"
                      ? "This browser can't show notifications."
                      : "Get a notification for new messages while you use other apps."}
              </small>
            </span>
            {permission === "granted" ? (
              <input type="checkbox" checked={prefs.system} onChange={() => toggle("system")} aria-label="Background notifications" />
            ) : permission === "default" ? (
              <button type="button" className="primary compact" onClick={enableSystem}>
                Turn on
              </button>
            ) : (
              <BellOff size={17} strokeWidth={1.8} />
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
