import React, { useEffect, useState } from "react";
import { Copy, TicketCheck } from "lucide-react";
import { adminApi } from "./adminApi.js";

/** A one-time Pro code, e.g. DCP-7KQ2M-PX9RA-3HWTN-BV4CE (no look-alike letters). */
export function generateProCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = Array.from(bytes, (x) => alphabet[x % alphabet.length]).join("");
  return `DCP-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}

export function Codes({ run, setToast }) {
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    run(adminApi.codes)
      .then(setCodes)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const copy = async (code) => {
    await navigator.clipboard?.writeText(code).catch(() => {});
    setToast("Code copied");
  };
  const create = async () => {
    setBusy(true);
    try {
      const code = await run(() => adminApi.createCode(generateProCode()));
      await navigator.clipboard?.writeText(code.code).catch(() => {});
      setToast(`${code.code} created and copied`);
      load();
    } catch (e) {
      setToast(`Couldn't create a code: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const available = (codes || []).filter((c) => c.status === "available");
  const used = (codes || []).filter((c) => c.status !== "available");
  return (
    <section className="ad-page">
      <div className="ad-head">
        <div>
          <h1>Pro codes</h1>
          <p className="ad-muted">One-time codes for members who pay in cash. Each code turns one account Pro, permanently.</p>
        </div>
        <div className="ad-head-actions">
          <button className="ad-btn ad-btn-primary" onClick={create} disabled={busy}>
            <TicketCheck size={15} /> {busy ? "Creating…" : "Generate code"}
          </button>
        </div>
      </div>
      {error && <div className="ad-error">{error}</div>}
      <div className="ad-grid ad-grid-2">
        <article className="ad-glass ad-card ad-rise" style={{ "--d": 0 }}>
          <span className="ad-card-label">Ready to give out · {available.length}</span>
          {!codes && <p className="ad-muted">Loading…</p>}
          {codes && !available.length && <p className="ad-empty">No unused codes. Generate one when a member pays.</p>}
          <ul className="ad-codes">
            {available.map((c) => (
              <li key={c.id}>
                <code>{c.code}</code>
                <small>{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ""}</small>
                <button className="ad-icon-btn" onClick={() => copy(c.code)} aria-label={`Copy ${c.code}`}>
                  <Copy size={15} />
                </button>
              </li>
            ))}
          </ul>
        </article>
        <article className="ad-glass ad-card ad-rise" style={{ "--d": 1 }}>
          <span className="ad-card-label">Redeemed · {used.length}</span>
          {codes && !used.length && <p className="ad-empty">No codes redeemed yet.</p>}
          <ul className="ad-codes">
            {used.map((c) => (
              <li key={c.id} className="is-used">
                <code>{c.code}</code>
                <span>
                  <b>{c.usedByName || "Member"}</b>
                  <small>{c.usedBy || ""}</small>
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
