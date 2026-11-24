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
  Network,
  MapPinned,
  Plus,
  Download,
  Trash2,
  Vault,
  Flag,
  History,
} from "lucide-react";
import "./styles.css";
import {
  cloudConfigured,
  getSession,
  requestEmailCode,
  verifyEmailCode,
  signOut,
  isCloudAdmin,
  createCloudAccessCode,
  listCloudAccessCodes,
  listCloudMembers,
  setCloudMemberPlan,
  setCloudMemberStatus,
  listAdminReports,
  reviewAdminReport,
  listAdminAudit,
} from "./cloud/cloudClient";

const AUDIT_LABELS = {
  "member.update": "Changed a member",
  "code.create": "Created a Pro code",
  "report.review": "Reviewed a report",
};
const describeAudit = (event, members) => {
  const target = members.find((m) => m.id === event.targetId);
  const d = event.detail || {};
  const parts = [];
  if (target) parts.push(target.name || target.email);
  if (d.plan) parts.push(`plan: ${d.plan}`);
  if (d.status) parts.push(`status: ${d.status}`);
  if (d.codeEnding) parts.push(`code ending ${d.codeEnding}`);
  if (d.note) parts.push(`note: ${d.note}`);
  return parts.join(" · ");
};

const KEY = "datachat-v1";
const sampleAdmin = {
  id: "admin",
  name: "DataChat Administrator",
  plan: "Admin",
  role: "admin",
  status: "active",
};
const emptyAdminDb = {
  users: [sampleAdmin],
  accessCodes: [],
  communities: [],
  recoveryBackups: [],
  adminConfig: {
    repositoryUrl: "https://github.com/lamek-star/Data-chat",
    paymentUrl: import.meta.env.VITE_STRIPE_PAYMENT_LINK || "",
    supportEmail: "support@datachat.app",
  },
};
const read = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved) return emptyAdminDb;
    const users = Array.isArray(saved.users) ? saved.users : [];
    return {
      ...emptyAdminDb,
      ...saved,
      users: users.some((user) => user.role === "admin")
        ? users
        : [...users, sampleAdmin],
      accessCodes: saved.accessCodes || [],
      communities: saved.communities || [],
      recoveryBackups: saved.recoveryBackups || [],
      adminConfig: {
        ...emptyAdminDb.adminConfig,
        ...(saved.adminConfig || {}),
      },
    };
  } catch {
    return emptyAdminDb;
  }
};
const makeCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = Array.from(bytes, (x) => alphabet[x % alphabet.length]).join("");
  return `DCP-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
};
function AdminApp() {
  const [db, setDb] = useState(read),
    [loggedIn, setLoggedIn] = useState(false),
    [checking, setChecking] = useState(cloudConfigured),
    [error, setError] = useState(""),
    [codeEmail, setCodeEmail] = useState(""),
    [members, setMembers] = useState([]),
    [reports, setReports] = useState([]),
    [audit, setAudit] = useState([]),
    [reportFilter, setReportFilter] = useState("open"),
    [toast, setToast] = useState("");
  const accessCodeUserName = (accessCode) =>
    accessCode.usedByName ||
    (db.users || []).find(
      (user) => user.id === accessCode.usedById || user.email === accessCode.usedBy,
    )?.name ||
    "Unknown user";
  useEffect(() => {
    if (loggedIn) localStorage.setItem(KEY, JSON.stringify(db));
  }, [db, loggedIn]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 2500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  // Administrators are normal DataChat accounts with role = 'admin' in D1.
  // The Worker re-checks that role on every call, so this screen is a
  // convenience, not the security boundary.
  const openAdminSession = async () => {
    // A non-admin keeps their normal app session; the portal just refuses.
    if (!(await isCloudAdmin())) throw new Error("This account is not a DataChat administrator.");
    const [codes, cloudMembers, cloudReports, events] = await Promise.all([
      listCloudAccessCodes(),
      listCloudMembers(),
      listAdminReports(),
      listAdminAudit(),
    ]);
    setDb((current) => ({ ...current, accessCodes: codes }));
    setMembers(cloudMembers);
    setReports(cloudReports);
    setAudit(events);
    setLoggedIn(true);
  };
  useEffect(() => {
    if (!cloudConfigured) return;
    getSession()
      .then((session) => (session?.user ? openAdminSession() : null))
      .catch((sessionError) => setError(sessionError.message))
      .finally(() => setChecking(false));
  }, []);
  const login = async (e) => {
    e.preventDefault();
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (!cloudConfigured)
      return setError("The admin portal needs the cloud backend to be configured.");
    try {
      if (!codeEmail) {
        const email = String(f.email).trim().toLowerCase();
        await requestEmailCode(email);
        setCodeEmail(email);
        return;
      }
      await verifyEmailCode(codeEmail, f.code);
      await openAdminSession();
    } catch (loginError) {
      setError(loginError.message || "Administrator sign-in failed.");
    }
  };
  if (checking) return <main className="admin-login" />;
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
            Sign in with a DataChat account that has the administrator role.
            This portal controls access metadata only.
          </p>
          {/* Distinct keys: otherwise React reuses the email input for the
              code and it keeps the email address as its value. */}
          {codeEmail ? (
            <label key="code">
              Sign-in code
              <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength="8" required autoFocus placeholder="Enter 8 digits" />
              <small>Enter the eight-digit code sent to {codeEmail}.</small>
            </label>
          ) : (
            <label key="email">
              Administrator email
              <input name="email" type="email" required autoComplete="username" />
            </label>
          )}
          {error && <div className="error">{error}</div>}
          <button className="primary">{codeEmail ? "Sign in" : "Email me a sign-in code"}</button>
          {codeEmail && (
            <button type="button" className="secondary" onClick={() => { setCodeEmail(""); setError(""); }}>
              Use a different email
            </button>
          )}
          <a className="secondary admin-back" href="/">
            Return to user app
          </a>
        </form>
      </main>
    );
  // Members come from the database; every change is saved there (the
  // database re-checks the admin role) and the list is reloaded so the
  // screen never shows a change that did not happen.
  const users = members.filter((x) => x.role !== "admin");
  const updateUser = async (id, changes) => {
    try {
      if (changes.plan) await setCloudMemberPlan(id, changes.plan);
      if (changes.status) await setCloudMemberStatus(id, changes.status);
      setToast("Member updated");
    } catch (updateError) {
      setToast(`Update failed: ${updateError.message}`);
    } finally {
      setMembers(await listCloudMembers().catch(() => members));
      setAudit(await listAdminAudit().catch(() => audit));
    }
  };
  const refreshReports = async () => {
    const [r, a] = await Promise.all([listAdminReports().catch(() => reports), listAdminAudit().catch(() => audit)]);
    setReports(r);
    setAudit(a);
  };
  const review = async (report, status) => {
    let note = "";
    if (status !== "open") {
      note = window.prompt(status === "actioned" ? "What action did you take? (optional)" : "Why dismiss it? (optional)", "");
      if (note === null) return; // cancelled
    }
    try {
      await reviewAdminReport(report.id, status, note);
      setToast(status === "open" ? "Report reopened" : "Report updated");
    } catch (reviewError) {
      setToast(`Update failed: ${reviewError.message}`);
    } finally {
      await refreshReports();
    }
  };
  const suspendReported = async (report) => {
    if (!window.confirm(`Suspend ${report.reported.name}? They are signed out everywhere at once.`)) return;
    await updateUser(report.reported.id, { status: "suspended" });
    await refreshReports();
  };
  const openCount = reports.filter((r) => r.status === "open").length;
  const shownReports = reports.filter((r) => reportFilter === "all" || r.status === reportFilter);
  const generate = async () => {
    const code = makeCode();
    try {
      if (!cloudConfigured)
        throw new Error("Cloud administrator authentication is required.");
      const generated = await createCloudAccessCode(code);
      setDb((d) => ({
        ...d,
        accessCodes: [generated, ...(d.accessCodes || []).filter((item) => item.id !== generated.id)],
      }));
      navigator.clipboard?.writeText(code);
      setToast(`${code} generated in cloud and copied`);
    } catch (cloudError) {
      setToast(`Code generation failed: ${cloudError.message}`);
    }
  };
  const saveLinks = (e) => {
    e.preventDefault();
    const config = Object.fromEntries(new FormData(e.currentTarget));
    setDb((d) => ({ ...d, adminConfig: config }));
    setToast("Configuration saved");
  };
  const createCommunity = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const parent = (db.communities || []).find((x) => x.id === f.parentId);
    const community = {
      id: `community-${Date.now()}`,
      name: f.name,
      location: f.location,
      purpose: f.purpose,
      parentId: f.parentId || null,
      level: parent ? (parent.level || 0) + 1 : 0,
      createdBy: "admin",
      permissions: {
        allowSubgroups: f.allowSubgroups === "on",
        allowInvites: f.allowInvites === "on",
      },
      members: [],
      contactMembers: [],
      admins: ["admin"],
      createdAt: new Date().toISOString(),
    };
    setDb((d) => ({
      ...d,
      communities: [...(d.communities || []), community],
    }));
    e.currentTarget.reset();
    setToast(`${community.name} created`);
  };
  const downloadRecovery = (item) => {
    const url = URL.createObjectURL(
      new Blob([item.encrypted], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = item.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setToast("Encrypted recovery file downloaded");
  };
  const removeRecovery = (id) => {
    if (
      !confirm(
        "Delete this administrator recovery copy? This cannot be undone.",
      )
    )
      return;
    setDb((d) => ({
      ...d,
      recoveryBackups: (d.recoveryBackups || []).filter((x) => x.id !== id),
    }));
    setToast("Recovery copy deleted");
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
            signOut().catch(() => {});
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
              This portal exposes account metadata, access controls, and only
              user-consented encrypted recovery files. Messages, contacts,
              records, security keys, and backup passwords remain private.
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
                  <small>{u.username ? `@${u.username} · ` : ""}ID {u.id}</small>
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
                    <option value="suspended">Suspended</option>
                  </select>
                </label>
              </article>
            ))}
          </div>
        </section>
        <section className="panel admin-reports">
          <div className="panel-title">
            <div>
              <h2>
                <Flag /> Safety reports
              </h2>
              <p>{openCount ? `${openCount} waiting for review` : "Nothing waiting for review"}</p>
            </div>
            <div className="report-filter" role="group" aria-label="Filter reports">
              {["open", "actioned", "dismissed", "all"].map((f) => (
                <button
                  key={f}
                  aria-pressed={reportFilter === f}
                  className={reportFilter === f ? "active" : ""}
                  onClick={() => setReportFilter(f)}
                >
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {!shownReports.length && <p className="admin-empty">No {reportFilter === "all" ? "" : reportFilter + " "}reports.</p>}
          <div className="report-list">
            {shownReports.map((r) => (
              <article key={r.id} className={`report-card status-${r.status}`}>
                <header>
                  <b>{r.reason}</b>
                  <span className={`badge ${r.status === "open" ? "pending" : "completed"}`}>{r.status}</span>
                </header>
                <small>{new Date(r.createdAt).toLocaleString()}</small>
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
                {r.details && <p className="report-details">{r.details}</p>}
                {r.evidence?.length > 0 && (
                  <details className="report-evidence">
                    <summary>{r.evidence.length} message(s) from the conversation</summary>
                    <ol>
                      {r.evidence.map((m, i) => (
                        <li key={i} className={m.senderId === r.reported.id ? "from-reported" : ""}>
                          <b>{m.senderId === r.reported.id ? r.reported.name : r.reporter.name}</b>
                          <span>{m.text}</span>
                          <small>{new Date(m.at).toLocaleString()}</small>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {r.adminNote && <p className="report-note">Note: {r.adminNote}</p>}
                <div className="report-actions">
                  {r.reported.status !== "suspended" && (
                    <button className="secondary danger" onClick={() => suspendReported(r)}>
                      Suspend member
                    </button>
                  )}
                  {r.status === "open" ? (
                    <>
                      <button className="secondary" onClick={() => review(r, "actioned")}>
                        Mark actioned
                      </button>
                      <button className="secondary" onClick={() => review(r, "dismissed")}>
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <button className="secondary" onClick={() => review(r, "open")}>
                      Reopen
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel admin-audit">
          <div className="panel-title">
            <div>
              <h2>
                <History /> Admin activity
              </h2>
              <p>Every change made in this portal, newest first.</p>
            </div>
          </div>
          {!audit.length && <p className="admin-empty">No admin actions yet.</p>}
          <ol className="audit-list">
            {audit.slice(0, 50).map((e) => (
              <li key={e.id}>
                <b>{AUDIT_LABELS[e.action] || e.action}</b>
                <span>{describeAudit(e, members)}</span>
                <small>
                  {e.adminEmail} · {new Date(e.createdAt).toLocaleString()}
                </small>
              </li>
            ))}
          </ol>
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
        <section className="panel admin-community-panel">
          <div className="panel-title">
            <div>
              <h2>
                <Network /> Community hierarchy
              </h2>
              <p>
                Create location-based parent communities and define delegated
                authority.
              </p>
            </div>
          </div>
          <div className="admin-community-layout">
            <form
              className="form admin-community-form"
              onSubmit={createCommunity}
            >
              <label>
                Community name
                <input name="name" required maxLength="60" />
              </label>
              <label>
                Location
                <input
                  name="location"
                  required
                  placeholder="Global, country, region or city"
                />
              </label>
              <label>
                Parent community
                <select name="parentId">
                  <option value="">No parent · root level</option>
                  {(db.communities || []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {"—".repeat(x.level || 0)} {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Purpose
                <textarea name="purpose" required minLength="12" />
              </label>
              <label className="check-row">
                <input type="checkbox" name="allowSubgroups" defaultChecked />
                <span>
                  <b>Allow delegated subgroups</b>
                  <small>
                    Authorized users can create a group below this community.
                  </small>
                </span>
              </label>
              <label className="check-row">
                <input type="checkbox" name="allowInvites" defaultChecked />
                <span>
                  <b>Allow contact invitations</b>
                  <small>Group authorities can add trusted contacts.</small>
                </span>
              </label>
              <button className="primary">
                <Plus />
                Create community
              </button>
            </form>
            <div className="admin-community-tree">
              {(db.communities || []).map((x) => {
                const parent = (db.communities || []).find(
                  (p) => p.id === x.parentId,
                );
                return (
                  <article
                    key={x.id}
                    style={{ "--depth": Math.min(x.level || 0, 3) }}
                  >
                    <span>
                      <MapPinned />
                    </span>
                    <div>
                      <b>{x.name}</b>
                      <small>
                        {x.location} · Level {x.level || 0}
                      </small>
                      <p>{x.purpose}</p>
                      <em>
                        {parent ? `Under ${parent.name}` : "Root community"} ·{" "}
                        {x.permissions?.allowSubgroups
                          ? "Subgroups allowed"
                          : "Closed hierarchy"}
                      </em>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <section className="panel admin-vault">
          <div className="panel-title">
            <div>
              <h2>
                <Vault /> Pro recovery vault
              </h2>
              <p>
                Encrypted copies deliberately stored by Pro users. You can
                retain or return a file, but cannot open it without the user’s
                password.
              </p>
            </div>
            <span className="badge completed">
              {(db.recoveryBackups || []).length} stored
            </span>
          </div>
          <div className="recovery-list">
            {!(db.recoveryBackups || []).length && (
              <div className="vault-empty">
                <Vault />
                <b>No recovery copies yet</b>
                <small>
                  A Pro user must explicitly choose “Store with admin.”
                </small>
              </div>
            )}
            {(db.recoveryBackups || []).map((x) => (
              <article key={x.id}>
                <span className="recovery-file">
                  <Vault />
                </span>
                <div>
                  <b>{x.userName}</b>
                  <span>{x.userEmail}</span>
                  <small>
                    {new Date(x.createdAt).toLocaleString()} · {x.format}
                  </small>
                  {x.passwordHint && <em>Password hint: {x.passwordHint}</em>}
                </div>
                <button
                  className="secondary"
                  onClick={() => downloadRecovery(x)}
                >
                  <Download />
                  Download
                </button>
                <button
                  className="icon-btn danger"
                  onClick={() => removeRecovery(x.id)}
                  aria-label={`Delete recovery copy for ${x.userName}`}
                >
                  <Trash2 />
                </button>
              </article>
            ))}
          </div>
          <div className="vault-warning">
            <LockKeyhole />
            <span>
              Never request or store the user’s actual backup password. Return
              the encrypted file and let the user decrypt it privately.
            </span>
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Access codes</h2>
              <p>Pro subscription codes. Used codes identify the member who redeemed them.</p>
            </div>
          </div>
          <div className="code-list">
            {(db.accessCodes || []).map((x) => (
              <div key={x.id}>
                <code>{x.code}</code>
                <span className="badge completed">{x.status}</span>
                <b>{x.status === "used" ? accessCodeUserName(x) : "Not yet used"}</b>
                <small>{x.status === "used" ? (x.usedBy || "Account unavailable") : x.createdAt?.slice(0, 10)}</small>
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
