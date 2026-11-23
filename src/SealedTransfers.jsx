// Fingerprint-locked ("sealed") transfers and fingerprint unlock setup.
// The sender locks a transfer to a receiver; the QR code holds only a link
// with a random code. The receiver opens it with their fingerprint, face or
// device PIN (a passkey), and the server checks that before showing details.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";
import { Copy, Fingerprint, LockKeyhole, MessageCircle, ScanLine, Share2, ShieldCheck, Smartphone, Trash2, Unlock, X } from "lucide-react";
import {
  createSealedTransfer,
  listPasskeys,
  listSealedTransfers,
  openSealedTransfer,
  passkeySupport,
  registerPasskey,
  removePasskey,
  sealLink,
} from "./cloud/cloudClient";

export const OPEN_SEAL_EVENT = "datachat:open-seal";
/** Opens the unlock screen from anywhere (chat, scanner, links). */
export const requestOpenSeal = (code) => window.dispatchEvent(new CustomEvent(OPEN_SEAL_EVENT, { detail: code }));

/** Pulls a sealed-transfer code out of a scanned or pasted value. */
export function extractSealCode(value) {
  const text = String(value || "").trim();
  try {
    const fromLink = new URL(text).searchParams.get("seal");
    if (fromLink) return fromLink;
  } catch {
    /* not a link */
  }
  const match = text.match(/DCS1:[0-9a-fA-F-]{36}\.[A-Za-z0-9_-]{20,64}/);
  return match ? match[0] : "";
}

const deviceLabel = () => {
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "Android phone";
  if (/iPhone|iPad/i.test(ua)) return "iPhone";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Mac/i.test(ua)) return "Mac";
  return "This device";
};
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

function Sheet({ title, close, children }) {
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}

// ----------------------------------------------------------- Settings --

export function PasskeyPanel({ setToast }) {
  const [devices, setDevices] = useState(null);
  const [support, setSupport] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => listPasskeys().then(setDevices).catch(() => setDevices([]));
  useEffect(() => {
    refresh();
    passkeySupport().then(setSupport);
  }, []);
  const setUp = async () => {
    setBusy(true);
    try {
      await registerPasskey(deviceLabel());
      setToast("Fingerprint unlock is set up on this device");
      refresh();
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    if (!confirm("Remove this device? Locked transfers can no longer be opened with it.")) return;
    try {
      await removePasskey(id);
      refresh();
    } catch (error) {
      setToast(error.message);
    }
  };
  return (
    <section className="panel passkey-panel">
      <div className="panel-title">
        <div>
          <h3>
            <Fingerprint size={18} /> Fingerprint unlock
          </h3>
          <p>Locked transfers sent to you open only after your fingerprint, face or device PIN on a registered device.</p>
        </div>
      </div>
      {devices?.length ? (
        <ul className="passkey-list">
          {devices.map((d) => (
            <li key={d.id}>
              <Smartphone size={16} />
              <span>
                <b>{d.deviceName}</b>
                <small>Added {when(d.createdAt)}{d.lastUsedAt ? ` · last used ${when(d.lastUsedAt)}` : ""}</small>
              </span>
              <button className="icon-btn" aria-label={`Remove ${d.deviceName}`} onClick={() => remove(d.id)}>
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        devices && <p className="muted">No devices yet.</p>
      )}
      {support && !support.supported && <p className="billing-note">{support.reason}</p>}
      <button className="primary" disabled={busy || (support && !support.supported)} onClick={setUp}>
        <Fingerprint size={16} />
        {busy ? "Waiting for your fingerprint…" : "Set up on this device"}
      </button>
    </section>
  );
}

// ------------------------------------------------------- Share record --

/** "Lock to receiver" section of the share dialog. */
export function LockedShareSection({ details, reference, contacts, onSendInChat, setToast }) {
  const cloudContacts = contacts.filter((c) => c.remoteUserId);
  const [contactId, setContactId] = useState(cloudContacts[0]?.id || "");
  const [sealed, setSealed] = useState(null);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const contact = cloudContacts.find((c) => c.id === contactId);
  const lock = async () => {
    if (!contact) return;
    setBusy(true);
    try {
      const result = await createSealedTransfer(contact.remoteUserId, details);
      const link = sealLink(result.code);
      setSealed({ ...result, link });
      setQr(await QRCode.toDataURL(link, { width: 300, margin: 3, errorCorrectionLevel: "M" }));
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusy(false);
    }
  };
  if (!cloudContacts.length)
    return (
      <div className="locked-share">
        <p className="muted">
          <LockKeyhole size={14} /> To lock a transfer to a receiver's fingerprint, add them as a DataChat contact first.
        </p>
      </div>
    );
  return (
    <div className="locked-share">
      <div className="premium-note">
        <LockKeyhole size={18} />
        <div>
          <b>Lock to the receiver's fingerprint</b>
          <small>The QR code shows nothing by itself. Only {contact?.name || "the receiver"} can open it, with their fingerprint or face.</small>
        </div>
      </div>
      {!sealed ? (
        <div className="contact-send">
          <select aria-label="Receiver" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            {cloudContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="primary" onClick={lock} disabled={busy || !contact}>
            <LockKeyhole size={16} />
            {busy ? "Locking…" : "Create locked QR"}
          </button>
        </div>
      ) : (
        <div className="locked-result">
          {qr && <img src={qr} alt={`Locked QR code for ${reference}`} />}
          <p>
            <ShieldCheck size={14} /> Locked to <b>{sealed.recipientName}</b>. Anyone else who scans it sees nothing.
          </p>
          <div className="share-actions">
            <button className="primary" onClick={() => onSendInChat(contact, sealed.code)}>
              <MessageCircle size={16} /> Send in chat
            </button>
            <button
              className="secondary"
              onClick={async () => {
                await navigator.clipboard?.writeText(sealed.link);
                setToast("Locked link copied");
              }}
            >
              <Copy size={16} /> Copy link
            </button>
            {navigator.share && (
              <button className="secondary" onClick={() => navigator.share({ title: `Locked transfer ${reference}`, url: sealed.link }).catch(() => {})}>
                <Share2 size={16} /> Share
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- Unlock --

const FIELDS = [
  ["reference", "Reference"],
  ["amount", "Amount"],
  ["sender", "Sender"],
  ["receiver", "Receiver"],
  ["route", "Route"],
  ["date", "Date"],
  ["status", "Status"],
  ["note", "Note"],
];

export function SealOpenModal({ code, close, setToast }) {
  const [state, setState] = useState({ step: "ready" });
  const unlock = async () => {
    setState({ step: "working" });
    try {
      setState({ step: "opened", result: await openSealedTransfer(code) });
    } catch (error) {
      setState({ step: error.reason === "NO_PASSKEY" ? "setup" : "error", message: error.message });
    }
  };
  const setUpThenUnlock = async () => {
    setState({ step: "working" });
    try {
      await registerPasskey(deviceLabel());
      setState({ step: "opened", result: await openSealedTransfer(code) });
    } catch (error) {
      setState({ step: "error", message: error.message });
    }
  };
  const d = state.result?.details || {};
  const view = {
    ...d,
    amount: d.amount !== undefined ? `${d.amount} ${d.currency || ""}`.trim() : undefined,
    route: d.from || d.to ? `${d.from || "?"} → ${d.to || "?"}` : undefined,
  };
  return (
    <Sheet title="Locked transfer" close={close}>
      {state.step === "opened" ? (
        <div className="seal-opened">
          <p className="seal-badge">
            <Unlock size={16} /> Opened with your fingerprint · from <b>{state.result.senderName}</b>
          </p>
          <dl>
            {FIELDS.filter(([key]) => view[key]).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{String(view[key])}</dd>
              </div>
            ))}
          </dl>
          {d.claimCode && (
            <div className="seal-claim">
              <small>Your cash claim code — show it only to the cash agent</small>
              <code>{d.claimCode}</code>
              <button
                className="secondary"
                onClick={async () => {
                  await navigator.clipboard?.writeText(d.claimCode);
                  setToast("Claim code copied");
                }}
              >
                <Copy size={16} /> Copy claim code
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="seal-locked">
          <span className="seal-icon">
            <Fingerprint size={40} />
          </span>
          {state.step === "setup" ? (
            <>
              <p>Set up fingerprint unlock on this device to open transfers sent to you.</p>
              <button className="primary" onClick={setUpThenUnlock}>
                <Fingerprint size={16} /> Set up and unlock
              </button>
            </>
          ) : (
            <>
              <p>This transfer is locked to its receiver. Confirm it's you with your fingerprint, face or device PIN.</p>
              {state.step === "error" && <div className="error">{state.message}</div>}
              <button className="primary" onClick={unlock} disabled={state.step === "working"}>
                <Fingerprint size={16} /> {state.step === "working" ? "Waiting for your fingerprint…" : "Unlock with fingerprint"}
              </button>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Paste or scan a locked QR, and see locked transfers sent to you. */
export function OpenSealDialog({ close, setToast }) {
  const [value, setValue] = useState("");
  const [received, setReceived] = useState([]);
  const fileRef = useRef(null);
  useEffect(() => {
    listSealedTransfers("received").then(setReceived).catch(() => {});
  }, []);
  const open = (raw) => {
    const code = extractSealCode(raw);
    if (!code) return setToast("That is not a DataChat locked transfer code");
    close();
    requestOpenSeal(code);
  };
  const scanFile = async (file) => {
    if (!file) return;
    try {
      const scanner = new Html5Qrcode("seal-qr-reader");
      const result = await scanner.scanFile(file, false);
      scanner.clear();
      open(result);
    } catch {
      setToast("No QR code found in that photo");
    }
  };
  return (
    <Sheet title="Open locked transfer" close={close}>
      <div className="form">
        <label>
          Paste the locked link or code
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…/?seal=DCS1:… or DCS1:…" />
        </label>
        <div className="share-actions">
          <button className="primary" onClick={() => open(value)} disabled={!value.trim()}>
            <Unlock size={16} /> Open
          </button>
          <button className="secondary" onClick={() => fileRef.current?.click()}>
            <ScanLine size={16} /> Scan QR photo
          </button>
          <input ref={fileRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => scanFile(e.target.files?.[0])} />
        </div>
        <div id="seal-qr-reader" hidden />
        {received.length > 0 && (
          <div className="sealed-inbox">
            <h4>Locked transfers sent to you</h4>
            <ul>
              {received.map((s) => (
                <li key={s.id}>
                  <LockKeyhole size={14} /> From <b>{s.senderName}</b> · {when(s.createdAt)} · {s.openedAt ? "opened" : "not opened yet"}
                </li>
              ))}
            </ul>
            <small className="muted">Scan the QR code or open the link from the sender to unlock one.</small>
          </div>
        )}
      </div>
    </Sheet>
  );
}
