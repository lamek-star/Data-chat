import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, Flag, LayoutDashboard, LockKeyhole, LogOut, Network, ShieldCheck, Store, TicketCheck, Timer, Users } from "lucide-react";
import { adminApi } from "./adminApi.js";
import { Overview } from "./Overview.jsx";
import { Members } from "./Members.jsx";
import { Codes } from "./Codes.jsx";
import { Reports } from "./Reports.jsx";
import { ActivityLog } from "./ActivityLog.jsx";
import { Offers } from "./Offers.jsx";
import { Communities } from "./Communities.jsx";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "members", label: "Members", icon: Users },
  { id: "codes", label: "Pro codes", icon: TicketCheck },
  { id: "offers", label: "Offers", icon: Store },
  { id: "communities", label: "Communities", icon: Network },
  { id: "reports", label: "Reports", icon: Flag },
  { id: "activity", label: "Activity", icon: Activity },
];

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "A";

/** Pill navigation with a highlight that slides to the active tab. */
function PillNav({ tab, setTab, badges }) {
  const listRef = useRef(null);
  const [pill, setPill] = useState(null);
  useLayoutEffect(() => {
    const update = () => {
      const button = listRef.current?.querySelector(`[data-tab="${tab}"]`);
      if (button) setPill({ left: button.offsetLeft, width: button.offsetWidth });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [tab]);
  return (
    <nav className="ad-nav" aria-label="Dashboard sections" ref={listRef}>
      {pill && <span className="ad-nav-pill" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} aria-hidden="true" />}
      {TABS.map(({ id, label, icon: Icon }) => (
        <button key={id} data-tab={id} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
          <Icon size={15} strokeWidth={1.9} />
          <span>{label}</span>
          {badges[id] > 0 && <em>{badges[id]}</em>}
        </button>
      ))}
    </nav>
  );
}

function SignIn({ notice }) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("email");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try {
      if (step === "email") {
        const value = String(form.get("email") || "").trim().toLowerCase();
        await adminApi.requestCode(value);
        setEmail(value);
        setStep("code");
      } else {
        await adminApi.verifyCode(email, String(form.get("code") || ""));
        window.location.reload();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="ad-signin">
      <form className="ad-glass ad-signin-card ad-rise" onSubmit={submit}>
        <span className="ad-mark">
          <ShieldCheck size={22} />
        </span>
        <p className="ad-eyebrow">DataChat · Restricted</p>
        <h1>Admin sign-in</h1>
        <p className="ad-muted">
          {step === "email" ? "Enter your administrator email. We'll send a one-time code." : `If ${email} is an administrator, a code is on its way. It expires in 10 minutes.`}
        </p>
        {notice && <div className="ad-notice">{notice}</div>}
        {step === "email" ? (
          <label key="email">
            Administrator email
            <input name="email" type="email" required autoComplete="username" autoFocus />
          </label>
        ) : (
          <label key="code">
            8-digit code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required autoFocus placeholder="••••••••" />
          </label>
        )}
        {error && (
          <div className="ad-error" role="alert">
            {error}
          </div>
        )}
        <button className="ad-btn ad-btn-primary" disabled={busy}>
          {busy ? "Please wait…" : step === "email" ? "Email me a code" : "Sign in"}
        </button>
        {step === "code" && (
          <button type="button" className="ad-btn ad-btn-ghost" onClick={() => (setStep("email"), setError(""))}>
            Use a different email
          </button>
        )}
        <p className="ad-fineprint">
          <LockKeyhole size={13} /> Codes go only to administrator accounts. Sessions end after 30 minutes without activity.
        </p>
      </form>
    </main>
  );
}

export function AdminApp() {
  const [state, setState] = useState({ phase: "checking", user: null, notice: "" });
  const [tab, setTab] = useState(() => (TABS.some((t) => `#${t.id}` === window.location.hash) ? window.location.hash.slice(1) : "overview"));
  const [toast, setToast] = useState("");
  const [badges, setBadges] = useState({});
  const [lastActive, setLastActive] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const idleMinutes = state.idleMinutes || 30;

  const endSession = useCallback((notice = "Your admin session has ended. Sign in again.") => {
    setState({ phase: "signed-out", user: null, notice });
  }, []);

  /** Wraps every admin call: keeps the idle timer fresh and handles an expired session. */
  const run = useCallback(
    async (fn) => {
      try {
        const result = await fn();
        setLastActive(Date.now());
        return result;
      } catch (error) {
        if (error.status === 401) endSession();
        throw error;
      }
    },
    [endSession],
  );

  useEffect(() => {
    adminApi
      .session()
      .then(({ user, idleMinutes }) => setState({ phase: "ready", user, idleMinutes, notice: "" }))
      .catch((error) => setState({ phase: "signed-out", user: null, notice: error.status === 401 ? "" : error.message }));
  }, []);

  useEffect(() => {
    if (window.location.hash !== `#${tab}`) window.history.pushState(null, "", `#${tab}`);
  }, [tab]);
  // Back/forward and links to #members etc. switch the section.
  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.slice(1);
      if (TABS.some((t) => t.id === id)) setTab(id);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  // Session countdown (the server enforces it; this just shows it).
  useEffect(() => {
    if (state.phase !== "ready") return;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [state.phase]);
  const minutesLeft = Math.min(idleMinutes, Math.max(0, Math.ceil((lastActive + idleMinutes * 60000 - Math.max(now, lastActive)) / 60000)));
  useEffect(() => {
    if (state.phase === "ready" && minutesLeft === 0) endSession("You were signed out after 30 minutes without activity.");
  }, [minutesLeft, state.phase, endSession]);

  if (state.phase === "checking") return <main className="ad-signin" aria-busy="true" />;
  if (state.phase !== "ready") return <SignIn notice={state.notice} />;

  const signOut = async () => {
    await adminApi.signOut().catch(() => {});
    endSession("You signed out.");
  };
  const props = { run, setToast, setBadges, user: state.user, goTo: setTab };
  return (
    <div className="ad-shell">
      <header className="ad-top">
        <div className="ad-brand">
          <span className="ad-mark">
            <img src="/assets/datachat-logo.png" alt="" />
          </span>
          <div>
            <b>DataChat</b>
            <small>Admin</small>
          </div>
        </div>
        <PillNav tab={tab} setTab={setTab} badges={badges} />
        <div className="ad-top-actions">
          <span className={`ad-chip ${minutesLeft <= 5 ? "warn" : ""}`} title="Your session ends after 30 minutes without activity">
            <Timer size={13} /> {minutesLeft}m
          </span>
          <span className="ad-avatar" title={state.user.email}>
            {initials(state.user.name || state.user.email)}
          </span>
          <button className="ad-icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <main className="ad-main" key={tab}>
        {tab === "overview" && <Overview {...props} />}
        {tab === "members" && <Members {...props} />}
        {tab === "codes" && <Codes {...props} />}
        {tab === "reports" && <Reports {...props} />}
        {tab === "activity" && <ActivityLog {...props} />}
        {tab === "offers" && <Offers {...props} />}
        {tab === "communities" && <Communities {...props} />}
      </main>
      {toast && (
        <div className="ad-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
