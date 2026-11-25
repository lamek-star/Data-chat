import React, { useEffect, useState } from "react";
import { adminApi } from "./adminApi.js";

const FILTERS = ["open", "actioned", "dismissed", "all"];

export function Reports({ run, setToast, setBadges }) {
  const [reports, setReports] = useState(null);
  const [filter, setFilter] = useState("open");
  const [error, setError] = useState("");
  const load = () =>
    run(() => adminApi.reports())
      .then((list) => {
        setReports(list);
        setBadges((b) => ({ ...b, reports: list.filter((r) => r.status === "open").length }));
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const review = async (report, status) => {
    let note = "";
    if (status !== "open") {
      note = window.prompt(status === "actioned" ? "What action did you take? (optional)" : "Why dismiss it? (optional)", "");
      if (note === null) return;
    }
    try {
      await run(() => adminApi.reviewReport(report.id, status, note));
      setToast(status === "open" ? "Report reopened" : "Report updated");
    } catch (e) {
      setToast(`Update failed: ${e.message}`);
    } finally {
      load();
    }
  };
  const suspend = async (report) => {
    if (!window.confirm(`Suspend ${report.reported.name}? They are signed out everywhere at once.`)) return;
    try {
      await run(() => adminApi.setStatus(report.reported.id, "suspended"));
      setToast(`${report.reported.name} suspended`);
    } catch (e) {
      setToast(`Couldn't suspend: ${e.message}`);
    } finally {
      load();
    }
  };

  const shown = (reports || []).filter((r) => filter === "all" || r.status === filter);
  return (
    <section className="ad-page">
      <div className="ad-head">
        <div>
          <h1>Safety reports</h1>
          <p className="ad-muted">Reports members sent about other members. The messages shown were copied by the server when the report was made.</p>
        </div>
        <div className="ad-segmented" role="group" aria-label="Filter reports">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? "active" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)} <span>{(reports || []).filter((r) => f === "all" || r.status === f).length}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <div className="ad-error">{error}</div>}
      {!reports && !error && <p className="ad-muted">Loading reports…</p>}
      {reports && !shown.length && <div className="ad-glass ad-card ad-empty">Nothing here. {filter === "open" ? "No reports are waiting." : ""}</div>}
      <div className="ad-reports">
        {shown.map((r, i) => (
          <article key={r.id} className={`ad-glass ad-card ad-report ad-rise status-${r.status}`} style={{ "--d": Math.min(i, 6) }}>
            <header>
              <b>{r.reason}</b>
              <span className={`ad-tag ${r.status}`}>{r.status}</span>
            </header>
            <small className="ad-muted">{new Date(r.createdAt).toLocaleString()}</small>
            <dl>
              <div>
                <dt>Reported</dt>
                <dd>
                  {r.reported.name} <span>{r.reported.email}</span>
                  {r.reported.status === "suspended" && <em> · suspended</em>}
                </dd>
              </div>
              <div>
                <dt>By</dt>
                <dd>
                  {r.reporter.name} <span>{r.reporter.email}</span>
                </dd>
              </div>
            </dl>
            {r.details && <p className="ad-quote">{r.details}</p>}
            {r.evidence?.length > 0 && (
              <details className="ad-evidence">
                <summary>{r.evidence.length} message(s) from the conversation</summary>
                <ol>
                  {r.evidence.map((m, j) => (
                    <li key={j} className={m.senderId === r.reported.id ? "from-reported" : ""}>
                      <b>{m.senderId === r.reported.id ? r.reported.name : r.reporter.name}</b>
                      <span>{m.text}</span>
                      <small>{new Date(m.at).toLocaleString()}</small>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {r.adminNote && <p className="ad-note">Note: {r.adminNote}</p>}
            <div className="ad-actions">
              {r.reported.status !== "suspended" && (
                <button className="ad-btn ad-btn-danger sm" onClick={() => suspend(r)}>
                  Suspend member
                </button>
              )}
              {r.status === "open" ? (
                <>
                  <button className="ad-btn ad-btn-ghost sm" onClick={() => review(r, "actioned")}>
                    Mark actioned
                  </button>
                  <button className="ad-btn ad-btn-ghost sm" onClick={() => review(r, "dismissed")}>
                    Dismiss
                  </button>
                </>
              ) : (
                <button className="ad-btn ad-btn-ghost sm" onClick={() => review(r, "open")}>
                  Reopen
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
