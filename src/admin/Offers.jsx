import React, { useEffect, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { adminApi } from "./adminApi.js";

const FILTERS = ["pending", "approved", "rejected", "withdrawn", "all"];
const LABEL = { pending: "Waiting", approved: "Live", rejected: "Rejected", withdrawn: "Withdrawn", all: "All" };

/** Rate offers members posted: approve to publish them for 30 days, or reject with a reason. */
export function Offers({ run, setToast, setBadges }) {
  const [offers, setOffers] = useState(null);
  const [filter, setFilter] = useState("pending");
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(null); // offer id with the reason box open
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");

  const load = () =>
    run(() => adminApi.offers())
      .then((list) => {
        setOffers(list);
        setBadges((b) => ({ ...b, offers: list.filter((o) => o.status === "pending").length }));
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const decide = async (offer, status, note = "") => {
    setBusy(offer.id);
    try {
      await run(() => adminApi.reviewOffer(offer.id, status, note));
      setToast(status === "approved" ? `${offer.provider}'s offer is live for 30 days` : "Offer rejected");
      setRejecting(null);
      setReason("");
    } catch (e) {
      setToast(`Couldn't update: ${e.message}`);
    } finally {
      setBusy("");
      load();
    }
  };

  const count = (f) => (offers || []).filter((o) => f === "all" || o.status === f).length;
  const shown = (offers || []).filter((o) => filter === "all" || o.status === filter);
  return (
    <section className="ad-page">
      <div className="ad-head">
        <div>
          <h1>Rate offers</h1>
          <p className="ad-muted">Offers members posted on the Rates page. Members see an offer only after you approve it; it stays up for 30 days.</p>
        </div>
        <div className="ad-segmented" role="group" aria-label="Filter offers">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? "active" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {LABEL[f]} <span>{count(f)}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <div className="ad-error">{error}</div>}
      {!offers && !error && <p className="ad-muted">Loading offers…</p>}
      {offers && !shown.length && <div className="ad-glass ad-card ad-empty">{filter === "pending" ? "No offers are waiting. New ones appear here." : "Nothing here."}</div>}
      <div className="ad-reports">
        {shown.map((o, i) => (
          <article key={o.id} className="ad-glass ad-card ad-report ad-rise" style={{ "--d": Math.min(i, 6) }}>
            <header>
              <b>{o.provider}</b>
              <span className={`ad-tag ${o.status === "approved" ? "actioned" : o.status === "pending" ? "trial" : "open"}`}>
                {o.expired && o.status === "approved" ? "Expired" : LABEL[o.status]}
              </span>
            </header>
            <div className="ad-offer-pair">
              <span>{o.side}</span>
              <b>
                {o.fromCurrency} <ArrowRight size={15} /> {o.toCurrency}
              </b>
              <strong>{o.rate}</strong>
            </div>
            <dl>
              <div>
                <dt>Amounts</dt>
                <dd>
                  {o.min.toLocaleString()}–{o.max.toLocaleString()} {o.fromCurrency} · {o.instrument}
                </dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>
                  {o.contact} <span>· {o.location}</span>
                </dd>
              </div>
              <div>
                <dt>Posted by</dt>
                <dd>
                  {o.ownerName} <span>{o.ownerEmail}</span>
                </dd>
              </div>
              <div>
                <dt>Dates</dt>
                <dd>
                  {new Date(o.createdAt).toLocaleDateString()}
                  {o.status === "approved" && <span> · live until {new Date(o.expiresAt).toLocaleDateString()}</span>}
                </dd>
              </div>
            </dl>
            {o.note && <p className="ad-quote">{o.note}</p>}
            {o.adminNote && <p className="ad-note">Note: {o.adminNote}</p>}
            {rejecting === o.id ? (
              <form
                className="ad-inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  decide(o, "rejected", reason);
                }}
              >
                <label htmlFor={`reason-${o.id}`}>Reason the member will see (optional)</label>
                <input id={`reason-${o.id}`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rate is far from the market" autoFocus />
                <div className="ad-actions">
                  <button className="ad-btn ad-btn-danger sm" disabled={busy === o.id}>
                    Reject offer
                  </button>
                  <button type="button" className="ad-btn ad-btn-ghost sm" onClick={() => setRejecting(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              o.status !== "withdrawn" && (
                <div className="ad-actions">
                  {o.status !== "approved" || o.expired ? (
                    <button className="ad-btn ad-btn-primary sm" disabled={busy === o.id} onClick={() => decide(o, "approved")}>
                      <Check size={14} /> {o.status === "approved" ? "Approve again" : "Approve"}
                    </button>
                  ) : null}
                  {o.status !== "rejected" && (
                    <button className="ad-btn ad-btn-ghost sm" disabled={busy === o.id} onClick={() => (setRejecting(o.id), setReason(""))}>
                      <X size={14} /> {o.status === "approved" ? "Take down" : "Reject"}
                    </button>
                  )}
                </div>
              )
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
