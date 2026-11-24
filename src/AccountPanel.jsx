// "Your data" in Settings: download everything DataChat holds about you, or
// delete the account for good. The server does the work (shared/account.js).
import React, { useState } from "react";
import { Download, Trash2, TriangleAlert } from "lucide-react";
import { deleteMyAccount, exportMyAccount } from "./cloud/cloudClient";

const WORKSPACE_KEY = "datachat-v1";

function saveJson(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function AccountPanel({ user, setToast }) {
  const [busy, setBusy] = useState(""),
    [confirming, setConfirming] = useState(false),
    [typed, setTyped] = useState(""),
    [error, setError] = useState("");

  const download = async () => {
    setBusy("export");
    try {
      const data = await exportMyAccount();
      saveJson(data, `datachat-my-data-${new Date().toISOString().slice(0, 10)}.json`);
      setToast("Your data was downloaded");
    } catch (e) {
      setToast(`Download failed: ${e.message}`);
    } finally {
      setBusy("");
    }
  };

  const remove = async (e) => {
    e.preventDefault();
    setError("");
    setBusy("delete");
    try {
      await deleteMyAccount(typed);
      // Clear this device's copy too, then start fresh at the sign-in screen.
      try {
        localStorage.removeItem(WORKSPACE_KEY);
        localStorage.removeItem("dc-user");
      } catch {
        /* storage unavailable */
      }
      window.location.replace("/");
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  };

  const matches = typed.trim().toLowerCase() === String(user.email || "").toLowerCase();

  return (
    <section className="panel account-data-panel">
      <div className="panel-title">
        <div>
          <h2>Your data</h2>
          <p>Download a copy of everything, or close your account.</p>
        </div>
      </div>
      <div className="account-data-actions">
        <button className="secondary" onClick={download} disabled={busy !== ""}>
          <Download size={18} />
          {busy === "export" ? "Preparing…" : "Download my data"}
        </button>
        {!confirming && (
          <button className="secondary danger" onClick={() => setConfirming(true)} disabled={busy !== ""}>
            <Trash2 size={18} />
            Delete account
          </button>
        )}
      </div>
      {confirming && (
        <form className="form account-delete-form" onSubmit={remove}>
          <div className="account-delete-warning">
            <TriangleAlert size={20} />
            <p>
              This deletes your account, messages, records, contacts and locked transfers from DataChat for good. It
              can’t be undone. Download your data first if you want a copy.
            </p>
          </div>
          <label>
            <span>
              Type <b>{user.email}</b> to confirm
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck="false"
              autoFocus
            />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => (setConfirming(false), setTyped(""), setError(""))}>
              Cancel
            </button>
            <button className="primary danger-submit" disabled={!matches || busy !== ""}>
              <Trash2 size={18} />
              {busy === "delete" ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
