import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { adminApi } from "./adminApi.js";

const FILTERS = ["All", "Pro", "Trial", "Free", "Suspended"];
const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
const planOf = (m) => (m.plan === "Pro" ? (m.trial ? "Trial" : "Pro") : "Free");

export function Members({ run, setToast, user }) {
  const [members, setMembers] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");

  const load = () =>
    run(adminApi.members)
      .then(setMembers)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members || [])
      .filter((m) => m.role !== "admin")
      .filter((m) => (filter === "All" ? true : filter === "Suspended" ? m.status === "suspended" : planOf(m) === filter && m.status !== "suspended"))
      .filter((m) => !q || `${m.name} ${m.email} ${m.username || ""}`.toLowerCase().includes(q));
  }, [members, query, filter]);

  const change = async (m, changes, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setSaving(m.id);
    try {
      if (changes.plan) await run(() => adminApi.setPlan(m.id, changes.plan));
      if (changes.status) await run(() => adminApi.setStatus(m.id, changes.status));
      setToast(`${m.name || m.email} updated`);
    } catch (e) {
      setToast(`Update failed: ${e.message}`);
    } finally {
      setSaving("");
      load();
    }
  };

  const counts = useMemo(() => {
    const list = (members || []).filter((m) => m.role !== "admin");
    return Object.fromEntries(FILTERS.map((f) => [f, list.filter((m) => (f === "All" ? true : f === "Suspended" ? m.status === "suspended" : planOf(m) === f && m.status !== "suspended")).length]));
  }, [members]);

  return (
    <section className="ad-page">
      <div className="ad-head">
        <div>
          <h1>Members</h1>
          <p className="ad-muted">Change a plan or suspend an account. Suspending signs the member out everywhere at once.</p>
        </div>
      </div>
      <div className="ad-glass ad-card ad-rise">
        <div className="ad-toolbar">
          <label className="ad-search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or username" aria-label="Search members" />
          </label>
          <div className="ad-segmented" role="group" aria-label="Filter members">
            {FILTERS.map((f) => (
              <button key={f} className={filter === f ? "active" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f} <span>{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
        {error && <div className="ad-error">{error}</div>}
        {!members && !error && <p className="ad-muted">Loading members…</p>}
        {members && !shown.length && <p className="ad-empty">No members match.</p>}
        <div className="ad-table" role="table" aria-label="Members">
          {shown.length > 0 && (
            <div className="ad-row ad-row-head" role="row">
              <span role="columnheader">Member</span>
              <span role="columnheader">Joined</span>
              <span role="columnheader">Plan</span>
              <span role="columnheader">Status</span>
            </div>
          )}
          {shown.map((m) => (
            <div key={m.id} className={`ad-row ${m.status === "suspended" ? "is-suspended" : ""} ${saving === m.id ? "is-saving" : ""}`} role="row">
              <span className="ad-member" role="cell">
                <i className="ad-avatar sm">{initials(m.name || m.email)}</i>
                <span>
                  <b>{m.name || "Unnamed"}</b>
                  <small>
                    {m.email}
                    {m.username ? ` · @${m.username}` : ""}
                  </small>
                </span>
              </span>
              <span role="cell" className="ad-muted" data-label="Joined">
                {m.createdAt ? new Date(m.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}
              </span>
              <span role="cell" data-label="Plan">
                <select
                  value={m.plan === "Pro" ? (m.trial ? "Trial" : "Pro") : "Free"}
                  onChange={(e) =>
                    change(m, { plan: e.target.value }, e.target.value === "Free" && m.trial ? `End ${m.name || m.email}'s free trial now?` : undefined)
                  }
                  aria-label={`Plan for ${m.name || m.email}`}
                  disabled={saving === m.id}
                >
                  {m.trial && (
                    <option value="Trial" disabled>
                      Trial
                    </option>
                  )}
                  <option value="Pro">Pro{m.trial ? " (permanent)" : ""}</option>
                  <option value="Free">{m.trial ? "Free (ends trial)" : "Free"}</option>
                </select>
                {m.trial && m.proUntil && <small className="ad-tag trial">Trial to {new Date(m.proUntil).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</small>}
              </span>
              <span role="cell" data-label="Status">
                {m.id === user.id ? (
                  <small className="ad-muted">You</small>
                ) : m.status === "suspended" ? (
                  <button className="ad-btn ad-btn-ghost sm" onClick={() => change(m, { status: "active" })} disabled={saving === m.id}>
                    Reactivate
                  </button>
                ) : (
                  <button
                    className="ad-btn ad-btn-danger sm"
                    onClick={() => change(m, { status: "suspended" }, `Suspend ${m.name || m.email}? They are signed out everywhere at once.`)}
                    disabled={saving === m.id}
                  >
                    Suspend
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
