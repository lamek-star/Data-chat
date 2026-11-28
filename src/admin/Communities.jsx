import React, { useEffect, useState } from "react";
import { Archive, CornerDownRight, Network, Plus, RotateCcw, Users } from "lucide-react";
import { adminApi } from "./adminApi.js";

/** Parents first, each followed by its own groups (depth-first), oldest first. */
export function treeOrder(list) {
  const children = new Map();
  for (const c of list) {
    const key = list.some((p) => p.id === c.parentId) ? c.parentId : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(c);
  }
  const out = [];
  const walk = (key) => (children.get(key) || []).forEach((c) => (out.push(c), walk(c.id)));
  walk(null);
  return out;
}

/** Create the top-level communities members join, and archive any group. */
export function Communities({ run, setToast }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  const load = () =>
    run(adminApi.communities)
      .then(setList)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const create = async (event) => {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget));
    setBusy("create");
    try {
      await run(() => adminApi.createCommunity({ ...f, parentId: f.parentId || null, allowSubgroups: f.allowSubgroups === "on" }));
      setToast(`${f.name} created`);
      setOpen(false);
    } catch (e) {
      setToast(`Couldn't create: ${e.message}`);
    } finally {
      setBusy("");
      load();
    }
  };
  const setStatus = async (c, status) => {
    if (status === "archived" && !window.confirm(`Archive ${c.name}? Members won't see it any more.`)) return;
    setBusy(c.id);
    try {
      await run(() => adminApi.setCommunity(c.id, status));
      setToast(status === "archived" ? `${c.name} archived` : `${c.name} restored`);
    } catch (e) {
      setToast(`Couldn't update: ${e.message}`);
    } finally {
      setBusy("");
      load();
    }
  };

  const active = treeOrder((list || []).filter((c) => c.status === "active"));
  const archived = (list || []).filter((c) => c.status === "archived");
  const byId = new Map((list || []).map((c) => [c.id, c]));
  const row = (c) => (
    <li key={c.id} className={c.status === "archived" ? "is-archived" : ""} style={{ "--depth": Math.min(c.level, 3) }}>
      <span className="ad-feed-icon">{c.parentId ? <CornerDownRight size={15} /> : <Network size={15} />}</span>
      <div>
        <b>{c.name}</b>
        <span>
          {c.location} · {c.adminRun ? "Run by DataChat, open to join" : `Started by ${c.ownerName || "a member"}, owner approves members`}
          {c.parentId && byId.get(c.parentId) ? ` · under ${byId.get(c.parentId).name}` : ""}
        </span>
        <small>
          <Users size={12} /> {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
          {c.allowSubgroups ? " · allows groups inside" : ""}
        </small>
      </div>
      {c.status === "active" ? (
        <button className="ad-btn ad-btn-ghost sm" disabled={busy === c.id} onClick={() => setStatus(c, "archived")}>
          <Archive size={14} /> Archive
        </button>
      ) : (
        <button className="ad-btn ad-btn-ghost sm" disabled={busy === c.id} onClick={() => setStatus(c, "active")}>
          <RotateCcw size={14} /> Restore
        </button>
      )}
    </li>
  );

  return (
    <section className="ad-page">
      <div className="ad-head">
        <div>
          <h1>Communities</h1>
          <p className="ad-muted">Communities you create are open for anyone to join. Members can start groups inside the ones that allow it; a group's owner approves who joins.</p>
        </div>
        <div className="ad-head-actions">
          <button className="ad-btn ad-btn-primary" onClick={() => setOpen((x) => !x)}>
            <Plus size={15} /> New community
          </button>
        </div>
      </div>
      {error && <div className="ad-error">{error}</div>}
      {open && (
        <form className="ad-glass ad-card ad-rise ad-create-form" onSubmit={create}>
          <label>
            Name
            <input name="name" required minLength={3} maxLength={60} placeholder="e.g. Ethiopians in Saudi Arabia" />
          </label>
          <label>
            Location
            <input name="location" required minLength={2} maxLength={80} placeholder="Country or city" />
          </label>
          <label className="wide">
            Purpose
            <input name="purpose" required minLength={12} maxLength={400} placeholder="What members use it for" />
          </label>
          <label>
            Inside (optional)
            <select name="parentId" defaultValue="">
              <option value="">Top level</option>
              {active
                .filter((c) => c.level < 4)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {"— ".repeat(c.level)}
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="ad-check">
            <input type="checkbox" name="allowSubgroups" defaultChecked /> Members can start groups inside it
          </label>
          <div className="ad-actions wide">
            <button className="ad-btn ad-btn-primary" disabled={busy === "create"}>
              {busy === "create" ? "Creating…" : "Create community"}
            </button>
            <button type="button" className="ad-btn ad-btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="ad-glass ad-card ad-rise">
        <span className="ad-card-label">Active · {active.length}</span>
        {!list && !error && <p className="ad-muted">Loading…</p>}
        {list && !active.length && <p className="ad-empty">No communities yet.</p>}
        <ol className="ad-feed ad-tree">{active.map(row)}</ol>
      </div>
      {archived.length > 0 && (
        <div className="ad-glass ad-card ad-rise" style={{ "--d": 1, marginTop: 16 }}>
          <span className="ad-card-label">Archived · {archived.length}</span>
          <ol className="ad-feed ad-tree">{archived.map(row)}</ol>
        </div>
      )}
    </section>
  );
}
