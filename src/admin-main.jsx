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
} from "lucide-react";
import "./styles.css";
import {
  cloudConfigured,
  configureCloudAdmin,
  createCloudAccessCode,
  listCloudAccessCodes,
} from "./cloud/supabaseClient";

const KEY = "datachat-v1";
const sampleAdmin = {
  id: "admin",
  name: "DataChat Administrator",
  username: "datachat-harmony",
  plan: "Admin",
  role: "admin",
  status: "active",
};
const ADMIN_USERNAME = "datachat-harmony";
const encodeBytes = (bytes) => btoa(String.fromCharCode(...bytes));
const decodeBytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
async function deriveAdminHash(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 }, material, 256);
  return encodeBytes(new Uint8Array(bits));
}
async function createAdminCredential(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: encodeBytes(salt), hash: await deriveAdminHash(password, salt), iterations: 310000 };
}
async function verifyAdminCredential(password, credential) {
  if (!credential?.salt || !credential?.hash) return false;
  return (await deriveAdminHash(password, decodeBytes(credential.salt))) === credential.hash;
}
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
    [error, setError] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [cloudAdminPassword, setCloudAdminPassword] = useState(""),
    [toast, setToast] = useState("");
  const adminAccount = (db.users || []).find((user) => user.role === "admin");
  const needsAdminSetup = !adminAccount?.credential?.hash;
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
  const login = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const valid = f.username.trim().toLowerCase() === ADMIN_USERNAME && await verifyAdminCredential(f.password, adminAccount?.credential);
    if (!valid) return setError("Administrator credentials are incorrect.");
    if (cloudConfigured) {
      try {
        await configureCloudAdmin(ADMIN_USERNAME, f.password);
        const codes = await listCloudAccessCodes(ADMIN_USERNAME, f.password);
        setDb((current) => ({ ...current, accessCodes: codes }));
        setCloudAdminPassword(f.password);
      } catch (cloudError) {
        return setError(`Cloud administrator access failed: ${cloudError.message}`);
      }
    }
    sessionStorage.setItem("dc-admin", "true");
    setLoggedIn(true);
  };
  const setupAdmin = async (event) => {
    event.preventDefault();
    setError("");
    const form = Object.fromEntries(new FormData(event.currentTarget));
    if (form.password.length < 12) return setError("Use at least 12 characters for the administrator password.");
    if (form.password !== form.confirmPassword) return setError("The passwords do not match.");
    const credential = await createAdminCredential(form.password);
    if (cloudConfigured) {
      try {
        await configureCloudAdmin(ADMIN_USERNAME, form.password);
        setCloudAdminPassword(form.password);
      } catch (cloudError) {
        return setError(`Cloud administrator setup failed: ${cloudError.message}`);
      }
    }
    setDb((current) => ({ ...current, users: current.users.map((account) => account.role === "admin" ? { ...account, username: ADMIN_USERNAME, credential, password: undefined, email: undefined } : account) }));
    sessionStorage.setItem("dc-admin", "true");
    setLoggedIn(true);
  };
  if (!loggedIn && needsAdminSetup)
    return (
      <main className="admin-login"><form className="auth-card" onSubmit={setupAdmin}>
        <span className="admin-mark"><ShieldCheck /></span><p className="eyebrow">FIRST-TIME ADMIN SETUP</p><h1>Secure your admin portal</h1><p>Create the private password for the fixed DataChat administrator username.</p>
        <label>Administrator username<input name="username" value={ADMIN_USERNAME} readOnly autoComplete="username" /></label>
        <label>New password<span className="password-field"><input type={showPassword ? "text" : "password"} name="password" required minLength="12" autoComplete="new-password" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></span><small>At least 12 characters. It is stored as a PBKDF2-SHA256 hash.</small></label>
        <label>Confirm password<input type={showPassword ? "text" : "password"} name="confirmPassword" required minLength="12" autoComplete="new-password" /></label>
        {error && <div className="error">{error}</div>}<button className="primary">Save password and open admin</button><a className="secondary admin-back" href="/">Return to user app</a>
      </form></main>
    );
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
            Administrator username
            <input name="username" required value={ADMIN_USERNAME} readOnly autoComplete="username" />
          </label>
          <label>
            Password
            <span className="password-field"><input type={showPassword ? "text" : "password"} name="password" required autoComplete="current-password" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></span>
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
  const generate = async () => {
    const code = makeCode();
    try {
      const generated = cloudConfigured
        ? await createCloudAccessCode(
            ADMIN_USERNAME,
            cloudAdminPassword,
            code,
          )
        : {
            id: `code-${Date.now()}`,
            code,
            plan: "Pro",
            status: "available",
            paymentMethod: "Cash",
            createdAt: new Date().toISOString(),
          };
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
