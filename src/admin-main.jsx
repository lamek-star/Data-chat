import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ShieldCheck,
  LogOut,
  Save,
  TicketCheck,
  Copy,
  Users,
  LockKeyhole,
} from "lucide-react";
import "./styles.css";

const KEY = "datachat-v1";
const read = () => JSON.parse(localStorage.getItem(KEY) || "{}");
const makeCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = Array.from(bytes, (x) => alphabet[x % alphabet.length]).join("");
  return `DC-${raw.slice(0, 3)}-${raw.slice(3)}`;
};
function AdminApp() {
  const [db, setDb] = useState(read),
    [loggedIn, setLoggedIn] = useState(
      sessionStorage.getItem("dc-admin") === "true",
    ),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  useEffect(() => {
    if (loggedIn) localStorage.setItem(KEY, JSON.stringify(db));
  }, [db, loggedIn]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 2500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const login = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const admin = (db.users || []).find(
      (x) =>
        x.role === "admin" &&
        x.email === f.email.trim().toLowerCase() &&
        x.password === f.password,
    );
    if (!admin) return setError("Administrator credentials are incorrect.");
    sessionStorage.setItem("dc-admin", "true");
    setLoggedIn(true);
  };
  if (!loggedIn)
    return (
      <main className="admin-login">
        <form className="auth-card" onSubmit={login}>
          <span className="admin-mark">
            <ShieldCheck />
          </span>
          <p className="eyebrow">SEPARATE SECURE PORTAL</p>
          <h1>DataChat administration</h1>
          <p>
            User accounts cannot sign in here. This portal controls access
            metadata only.
          </p>
          <label>
            Email
            <input type="email" name="email" required autoComplete="username" />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary">Sign in</button>
          <a className="secondary admin-back" href="/">
            Return to user app
          </a>
        </form>
      </main>
    );
  const users = (db.users || []).filter((x) => x.role !== "admin");
  const updateUser = (id, changes) =>
    setDb((d) => ({
      ...d,
      users: d.users.map((x) => (x.id === id ? { ...x, ...changes } : x)),
    }));
  const generate = () => {
    const code = makeCode();
    setDb((d) => ({
      ...d,
      accessCodes: [
        {
          id: `code-${Date.now()}`,
          code,
          plan: "Pro",
          status: "available",
          paymentMethod: "Cash",
          createdAt: new Date().toISOString(),
        },
        ...(d.accessCodes || []),
      ],
    }));
    navigator.clipboard?.writeText(code);
    setToast(`${code} generated and copied`);
  };
  const saveLinks = (e) => {
    e.preventDefault();
    const config = Object.fromEntries(new FormData(e.currentTarget));
    setDb((d) => ({ ...d, adminConfig: config }));
    setToast("Configuration saved");
  };
  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div>
          <span className="admin-mark">
            <ShieldCheck />
          </span>
          <div>
            <b>DataChat Admin</b>
            <small>Account access portal</small>
          </div>
        </div>
        <button
          className="secondary"
          onClick={() => {
            sessionStorage.removeItem("dc-admin");
            setLoggedIn(false);
          }}
        >
          <LogOut />
          Sign out
        </button>
      </header>
      <main className="page admin-page">
        <header>
          <div>
            <h1>Administration</h1>
            <p>Manage access, plans, cash codes and shared configuration.</p>
          </div>
          <div className="actions">
            <button className="primary" onClick={generate}>
              <TicketCheck />
              Generate Pro cash code
            </button>
          </div>
        </header>
        <div className="admin-privacy">
          <LockKeyhole />
          <div>
            <b>Private workspace data stays hidden</b>
            <p>
              This separate portal only exposes account metadata and access
              controls—not messages, contacts, records, keys, or backups.
            </p>
          </div>
        </div>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>
                <Users /> Account access
              </h2>
              <p>{users.length} user account(s)</p>
            </div>
          </div>
          <div className="admin-users">
            {users.map((u) => (
              <article key={u.id}>
                <div className="avatar">
                  {u.name
                    ?.split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)}
                </div>
                <div className="admin-identity">
                  <b>{u.name}</b>
                  <span>{u.email}</span>
                  <small>ID {u.id}</small>
                </div>
                <label>
                  Plan
                  <select
                    value={u.plan || "Free"}
                    onChange={(e) => updateUser(u.id, { plan: e.target.value })}
                  >
                    <option>Free</option>
                    <option>Pro</option>
                  </select>
                </label>
                <label>
                  Status
                  <select
                    value={u.status || "active"}
                    onChange={(e) =>
                      updateUser(u.id, { status: e.target.value })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </label>
              </article>
            ))}
          </div>
        </section>
        <section className="panel admin-links">
          <div className="panel-title">
            <div>
              <h2>Shared app configuration</h2>
              <p>Repository, payment and support destinations.</p>
            </div>
          </div>
          <form className="admin-link-form" onSubmit={saveLinks}>
            <label>
              Repository URL
              <input
                name="repositoryUrl"
                type="url"
                defaultValue={db.adminConfig?.repositoryUrl || ""}
              />
            </label>
            <label>
              Payment URL
              <input
                name="paymentUrl"
                type="url"
                defaultValue={db.adminConfig?.paymentUrl || ""}
              />
            </label>
            <label>
              Support email
              <input
                name="supportEmail"
                type="email"
                defaultValue={db.adminConfig?.supportEmail || ""}
              />
            </label>
            <button className="primary">
              <Save />
              Save
            </button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Access codes</h2>
              <p>One-time codes for cash payment or invitation.</p>
            </div>
          </div>
          <div className="code-list">
            {(db.accessCodes || []).map((x) => (
              <div key={x.id}>
                <code>{x.code}</code>
                <span className="badge completed">{x.status}</span>
                <b>{x.plan}</b>
                <small>{x.usedBy || x.createdAt?.slice(0, 10)}</small>
                <button
                  className="icon-btn"
                  onClick={() => {
                    navigator.clipboard?.writeText(x.code);
                    setToast("Code copied");
                  }}
                >
                  <Copy />
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<AdminApp />);
