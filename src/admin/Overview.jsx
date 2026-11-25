import React, { useEffect, useState } from "react";
import { CalendarClock, Flag, KeyRound, LockKeyhole, MessagesSquare, RefreshCw, TicketCheck, UserCheck } from "lucide-react";
import { adminApi } from "./adminApi.js";
import { AreaChart, ColumnChart, CountUp, SegmentBar } from "./charts.jsx";
import { generateProCode } from "./Codes.jsx";

const greeting = (date) => {
  const h = date.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
const firstName = (user) => {
  const name = (user.name || user.email || "").split(/[\s@]/)[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
};
const sum = (series) => series.reduce((n, s) => n + s.count, 0);
const daysUntil = (iso) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000));
const COUNTRY_COLORS = ["#f2a679", "#e8c37a", "#7fc8b4", "#8fa8f0", "#c99be6", "#6b6560"];

function Kpi({ icon: Icon, label, value, note, tone, onClick }) {
  return (
    <button className={`ad-glass ad-kpi ${tone || ""}`} onClick={onClick} disabled={!onClick}>
      <span className="ad-kpi-icon">
        <Icon size={17} />
      </span>
      <span className="ad-kpi-label">{label}</span>
      <b>
        <CountUp value={value} />
      </b>
      {note && <small>{note}</small>}
    </button>
  );
}

export function Overview({ run, setToast, setBadges, user, goTo }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await run(adminApi.stats);
      setStats(next);
      setBadges((b) => ({ ...b, reports: next.reports.open }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const quickCode = async () => {
    try {
      const code = await run(() => adminApi.createCode(generateProCode()));
      await navigator.clipboard?.writeText(code.code).catch(() => {});
      setToast(`${code.code} created and copied`);
      load();
    } catch (e) {
      setToast(`Couldn't create a code: ${e.message}`);
    }
  };

  const today = new Date();
  if (!stats)
    return (
      <section className="ad-page">
        <div className="ad-head">
          <h1>
            {greeting(today)}, {firstName(user)}
          </h1>
          <p className="ad-muted">{error || "Loading the latest numbers…"}</p>
          {error && (
            <button className="ad-btn ad-btn-ghost" onClick={load}>
              Try again
            </button>
          )}
        </div>
        {!error && <div className="ad-skeleton-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="ad-glass ad-skeleton" />)}</div>}
      </section>
    );

  const newThisWeek = stats.signupsByWeek.at(-1).count;
  const lastWeek = stats.signupsByWeek.at(-2)?.count || 0;
  const messages14 = sum(stats.messagesByDay);
  const messages7 = sum(stats.messagesByDay.slice(-7));
  const prev7 = sum(stats.messagesByDay.slice(0, 7));
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0);
  const memberTotal = stats.members.total - stats.members.admins;

  return (
    <section className="ad-page">
      <div className="ad-head">
        <div>
          <span className="ad-live">
            <i /> Live · {today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </span>
          <h1>
            {greeting(today)}, {firstName(user)}
          </h1>
          <p className="ad-muted">
            {memberTotal.toLocaleString()} members · {newThisWeek} joined this week · {stats.reports.open ? `${stats.reports.open} report${stats.reports.open === 1 ? "" : "s"} waiting` : "no reports waiting"}
          </p>
        </div>
        <div className="ad-head-actions">
          <button className="ad-btn ad-btn-ghost" onClick={load} disabled={busy} aria-label="Refresh numbers">
            <RefreshCw size={15} className={busy ? "ad-spin" : ""} /> Refresh
          </button>
          <button className="ad-btn ad-btn-primary" onClick={quickCode}>
            <TicketCheck size={15} /> New Pro code
          </button>
        </div>
      </div>

      <div className="ad-grid">
        <article className="ad-glass ad-card ad-hero ad-rise" style={{ "--d": 0 }}>
          <header>
            <div>
              <span className="ad-card-label">Members</span>
              <div className="ad-big">
                <CountUp value={memberTotal} />
                <span className={`ad-delta ${newThisWeek >= lastWeek ? "up" : "down"}`}>
                  +{newThisWeek} this week{lastWeek ? ` · ${pct(newThisWeek, lastWeek) >= 0 ? "+" : ""}${pct(newThisWeek, lastWeek)}%` : ""}
                </span>
              </div>
              <small className="ad-muted">New sign-ups per week, last 12 weeks</small>
            </div>
          </header>
          <AreaChart series={stats.signupsByWeek} label="Sign-ups" />
          <SegmentBar
            parts={[
              { label: "Pro", value: stats.plans.pro, color: "#f2a679" },
              { label: "Trial", value: stats.plans.trial, color: "#e8c37a" },
              { label: "Free", value: stats.plans.free, color: "#7fc8b4" },
            ]}
          />
        </article>

        <article className="ad-glass ad-card ad-side ad-rise" style={{ "--d": 1 }}>
          <span className="ad-card-label">Message activity</span>
          <div className="ad-big ad-big-sm">
            <CountUp value={messages14} />
            <span className={`ad-delta ${messages7 >= prev7 ? "up" : "down"}`}>
              {prev7 ? `${pct(messages7, prev7) >= 0 ? "+" : ""}${pct(messages7, prev7)}% vs last week` : messages7 ? "New this week" : "Quiet this week"}
            </span>
          </div>
          <small className="ad-muted">Messages sent per day, 14 days. Counts only, never content.</small>
          <ColumnChart series={stats.messagesByDay} label="Messages per day" />
          <div className="ad-mini-row">
            <span>
              <b>{stats.members.activeLast7Days}</b> active this week
            </span>
            <span>
              <b>{stats.members.suspended}</b> suspended
            </span>
          </div>
        </article>

        <div className="ad-kpis">
          <Kpi icon={UserCheck} label="On a free trial" value={stats.plans.trial} note={`${stats.trialsEnding.length} ending in 14 days`} onClick={() => goTo("members")} />
          <Kpi icon={LockKeyhole} label="Locked transfers" value={stats.sealed.total} note={`${stats.sealed.opened} opened · ${stats.sealed.last30Days} in 30 days`} />
          <Kpi icon={Flag} label="Reports waiting" value={stats.reports.open} note={`${stats.reports.total} in total`} tone={stats.reports.open ? "alert" : ""} onClick={() => goTo("reports")} />
          <Kpi icon={KeyRound} label="Unused Pro codes" value={stats.codes.available} note={`${stats.codes.used} redeemed`} onClick={() => goTo("codes")} />
        </div>

        <article className="ad-glass ad-card ad-rise" style={{ "--d": 2 }}>
          <span className="ad-card-label">Where members are</span>
          <SegmentBar parts={stats.countries.map((c, i) => ({ label: c.country, value: c.members, color: COUNTRY_COLORS[i % COUNTRY_COLORS.length] }))} />
          <ul className="ad-rank">
            {stats.countries.map((c, i) => (
              <li key={c.country}>
                <i style={{ background: COUNTRY_COLORS[i % COUNTRY_COLORS.length] }} />
                <span>{c.country}</span>
                <b>{c.members}</b>
              </li>
            ))}
            {!stats.countries.length && <li className="ad-muted">No members yet.</li>}
          </ul>
        </article>

        <article className="ad-glass ad-card ad-rise" style={{ "--d": 3 }}>
          <header className="ad-card-head">
            <span className="ad-card-label">
              <CalendarClock size={14} /> Trials ending soon
            </span>
            <button className="ad-link" onClick={() => goTo("members")}>
              All members
            </button>
          </header>
          {stats.trialsEnding.length ? (
            <ol className="ad-timeline">
              {stats.trialsEnding.map((t) => (
                <li key={t.id}>
                  <time>{new Date(t.proUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
                  <div>
                    <b>{t.name}</b>
                    <small>{daysUntil(t.proUntil) === 0 ? "Ends today" : `Ends in ${daysUntil(t.proUntil)} day${daysUntil(t.proUntil) === 1 ? "" : "s"}`}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ad-empty">
              <MessagesSquare size={18} /> No trials end in the next 14 days.
            </p>
          )}
        </article>
      </div>
      <p className="ad-footnote">Updated {new Date(stats.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Private messages, contacts and transaction details are never shown here.</p>
    </section>
  );
}
