// Client for DataChat's own API on Cloudflare (shared/api.js in the Worker).
// Replaces the Supabase client: same function names, so the app barely
// changes. Browsers authenticate with an HttpOnly session cookie; the
// Android/iOS app keeps a session token and sends it as a Bearer header.

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ??
  // In development the Vite /api proxy serves the API on the same origin.
  (import.meta.env.DEV ? "" : "https://datachat.harmongt.uk")
).replace(/\/$/, "");

// VITE_DATACHAT_OFFLINE=1 runs the app on browser storage only.
const offline = import.meta.env.VITE_DATACHAT_OFFLINE === "1";
export const cloudConfigured = !offline;
export const cloudConfig = { apiBase: API_BASE };

const TOKEN_KEY = "dc-session-token";
const isNative = () => Boolean(globalThis.Capacitor?.isNativePlatform?.());
const storage = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (value) => {
    try {
      value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable: the cookie still works in browsers */
    }
  },
};

const absolute = (url) => (url && url.startsWith("/api/") ? `${API_BASE}${url}` : url);

// On a slow or flaky connection a request can hang for minutes. Give up
// after a while so the caller can retry instead of waiting forever.
const DEFAULT_TIMEOUT_MS = 20000;
const UPLOAD_TIMEOUT_MS = 90000;

async function api(path, { method = "GET", body, raw, contentType, timeoutMs } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (raw) headers["Content-Type"] = contentType;
  const token = storage.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs ?? (raw ? UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)) : null;
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      signal: controller?.signal,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    throw Object.assign(
      new Error(timedOut ? "The connection is too slow right now. DataChat will keep trying." : "Cannot reach DataChat. Check your connection and try again."),
      { status: 0, timedOut },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { status: response.status });
  return data;
}

// ------------------------------------------------------------------ auth --

let currentUser = null; // the API's view of the signed-in account
const listeners = new Set();
const emit = (event) => listeners.forEach((listener) => listener(event, currentUser ? { user: toAuthUser(currentUser) } : null));

// Shape the app expects from the old auth client.
function toAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    created_at: user.createdAt,
    user_metadata: {
      name: user.name,
      username: user.username,
      phone: user.phone,
      country: user.country,
      avatar_url: absolute(user.avatarUrl),
    },
  };
}

async function refreshUser() {
  const { user } = await api("/api/auth/session");
  currentUser = user;
  return user;
}

export async function getSession() {
  try {
    return { user: toAuthUser(await refreshUser()) };
  } catch (error) {
    if (error.status === 401) {
      currentUser = null;
      return null;
    }
    throw error;
  }
}

export function onAuthStateChange(callback) {
  listeners.add(callback);
  return { unsubscribe: () => listeners.delete(callback) };
}

/** Emails an 8-digit sign-in code. Works for new and existing accounts. */
export async function requestEmailCode(email) {
  await api("/api/auth/email/start", { method: "POST", body: { email } });
}

/** Checks the code; creates the account on first sign-in from `profile`. */
export async function verifyEmailCode(email, code, profile) {
  const result = await api("/api/auth/email/verify", {
    method: "POST",
    body: { email, code, profile, client: isNative() ? "native" : undefined },
  });
  if (result.token) storage.set(result.token);
  currentUser = result.user;
  emit("SIGNED_IN");
  return { user: toAuthUser(result.user) };
}

export async function signOut() {
  try {
    await api("/api/auth/logout", { method: "POST", body: {} });
  } finally {
    storage.set(null);
    currentUser = null;
    emit("SIGNED_OUT");
  }
  return true;
}

/** Bearer token for the native app; browsers rely on the session cookie. */
export async function getAccessToken() {
  return storage.get();
}

/** Plan, role and status always come from the server. */
export async function loadEntitlement() {
  const user = await refreshUser();
  return { plan: user.plan, role: user.role, status: user.status, trial: Boolean(user.trial), proUntil: user.proUntil || null };
}

// ------------------------------------------------------------------ data --

export async function loadAppData() {
  return (await api("/api/data")).records;
}

export async function overwriteAppData(_userId, records) {
  await api("/api/data", { method: "PUT", body: { records } });
  return true;
}

// ------------------------------------------------------------- profiles --

const profileRow = (p) => (p ? { ...p, avatar_url: absolute(p.avatar_url) } : p);

/** The signed-in member's own profile (phone included: it is theirs). */
export async function upsertPublicProfile() {
  const user = currentUser || (await refreshUser());
  return {
    id: user.id,
    display_name: user.name,
    username: user.username,
    contact_code: user.contactCode,
    country: user.country,
    phone: user.phone,
    avatar_url: absolute(user.avatarUrl),
  };
}

export async function findPublicProfile({ userId, contactCode }) {
  const query = userId ? `ids=${encodeURIComponent(userId)}` : `code=${encodeURIComponent(String(contactCode || "").trim())}`;
  const { profiles } = await api(`/api/profiles?${query}`);
  return profileRow(profiles[0]) || null;
}

export async function loadPublicProfiles(userIds) {
  const ids = [...new Set(userIds || [])];
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { profiles } = await api(`/api/profiles?ids=${ids.slice(i, i + 100).map(encodeURIComponent).join(",")}`);
    out.push(...profiles.map(profileRow));
  }
  return out;
}

// Phone photos are often several MB; shrink to 512 px JPEG before upload.
async function shrinkImage(file) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob || file;
  } catch {
    return file;
  }
}

export async function uploadProfilePhoto(_userId, file) {
  const image = await shrinkImage(file);
  const { avatarUrl } = await api("/api/profile/photo", { method: "PUT", raw: image, contentType: image.type || "image/jpeg" });
  if (currentUser) currentUser = { ...currentUser, avatarUrl };
  return absolute(avatarUrl);
}

// -------------------------------------------------------------- messages --

let latestMessageMs = 0;
const track = (rows) => {
  for (const row of rows) latestMessageMs = Math.max(latestMessageMs, row.created_ms || 0);
  return rows;
};

export async function loadDirectMessages() {
  const all = [];
  let since = 0;
  for (;;) {
    const { messages } = await api(`/api/messages?since=${since}`);
    all.push(...messages);
    if (messages.length < 500) break;
    since = messages.at(-1).created_ms;
  }
  return track(all);
}

export async function sendDirectMessage(recipientId, message) {
  const { message: row } = await api("/api/messages", { method: "POST", body: { id: message.id, recipientId, payload: message } });
  track([row]);
  return row;
}

/** Tells the server these incoming messages have been seen (read receipts, unread counts on other devices). */
export async function markMessagesRead(ids) {
  const list = [...new Set(ids)].slice(0, 100);
  if (!list.length) return { updated: 0 };
  return api("/api/messages/read", { method: "POST", body: { ids: list } });
}

/**
 * Delivers new messages by polling every few seconds while the app is open
 * and visible. Calls callback({ new: row }) like the old realtime channel.
 */
export function subscribeToDirectMessages(callback, { visibleMs = 2500, hiddenMs = 15000, maxBackoffMs = 30000 } = {}) {
  let stopped = false;
  let timer;
  let polling = false;
  let failures = 0;
  const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
  const schedule = (ms) => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(tick, ms);
  };
  const tick = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      // Short timeout: a poll that hangs on a slow link just tries again.
      const { messages } = await api(`/api/messages?since=${latestMessageMs}`, { timeoutMs: 12000 });
      failures = 0;
      for (const row of track(messages)) callback({ new: row });
    } catch {
      failures += 1; /* offline or signed out: back off, then try again */
    } finally {
      polling = false;
    }
    const base = hidden() ? hiddenMs : visibleMs;
    schedule(failures ? Math.min(maxBackoffMs, base * 2 ** Math.min(failures, 4)) : base);
  };
  const onWake = () => {
    if (!hidden()) {
      failures = 0;
      schedule(0);
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
  }
  schedule(visibleMs);
  return {
    /** Check for new messages now (after sending, when the network returns). */
    pollNow: () => schedule(0),
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onWake);
        document.removeEventListener("visibilitychange", onWake);
      }
    },
  };
}

export function unsubscribeChannel(channel) {
  channel?.stop?.();
}

// ------------------------------------------------------------------- Pro --

export async function redeemProAccessCode(code) {
  return api("/api/pro/redeem", { method: "POST", body: { code: String(code || "").trim().toUpperCase() } });
}

// ----------------------------------------------------------------- admin --
// The server re-checks the admin role on every call.

export async function isCloudAdmin() {
  const user = await refreshUser();
  return user.role === "admin" && user.status === "active";
}

export async function createCloudAccessCode(code) {
  return (await api("/api/admin/codes", { method: "POST", body: { code } })).code;
}

export async function listCloudAccessCodes() {
  return (await api("/api/admin/codes")).codes;
}

export async function listCloudMembers() {
  return (await api("/api/admin/members")).members;
}

export async function setCloudMemberPlan(userId, plan) {
  return api("/api/admin/members", { method: "PATCH", body: { userId, plan } });
}

export async function setCloudMemberStatus(userId, status) {
  return api("/api/admin/members", { method: "PATCH", body: { userId, status } });
}

// ------------------------------------------- passkeys (fingerprint unlock) --
// The browser shows the system fingerprint / face / PIN prompt; the server
// verifies the result. Nothing biometric ever leaves the device.

export async function passkeySupport() {
  const { browserSupportsWebAuthn, platformAuthenticatorIsAvailable } = await import("@simplewebauthn/browser");
  if (!browserSupportsWebAuthn()) return { supported: false, reason: "This browser does not support fingerprint or face unlock." };
  const platform = await platformAuthenticatorIsAvailable().catch(() => false);
  return platform
    ? { supported: true }
    : { supported: false, reason: "This device has no fingerprint, face or PIN unlock set up." };
}

export async function listPasskeys() {
  return (await api("/api/passkeys")).passkeys;
}

export async function registerPasskey(deviceName) {
  const { startRegistration } = await import("@simplewebauthn/browser");
  const optionsJSON = await api("/api/passkeys/register/options", { method: "POST", body: {} });
  let response;
  try {
    response = await startRegistration({ optionsJSON });
  } catch (error) {
    throw new Error(error.name === "NotAllowedError" ? "Fingerprint setup was cancelled." : error.message);
  }
  return api("/api/passkeys/register/verify", { method: "POST", body: { response, deviceName } });
}

export async function removePasskey(id) {
  return api("/api/passkeys/remove", { method: "POST", body: { id } });
}

// --------------------------------------------------- sealed transfers --

/** Locks transfer details to one receiver; returns { id, code, recipientName }. */
export async function createSealedTransfer(recipientId, details) {
  return api("/api/sealed", { method: "POST", body: { recipientId, details } });
}

export async function listSealedTransfers(box = "received") {
  return (await api(`/api/sealed?box=${box === "sent" ? "sent" : "received"}`)).seals;
}

/**
 * Asks for the receiver's fingerprint and returns the transfer details.
 * Throws an error with .reason === "NO_PASSKEY" when unlock isn't set up yet.
 */
export async function openSealedTransfer(code) {
  const { startAuthentication } = await import("@simplewebauthn/browser");
  let optionsJSON;
  try {
    optionsJSON = await api("/api/sealed/open/options", { method: "POST", body: { code } });
  } catch (error) {
    if (error.status === 409) error.reason = "NO_PASSKEY";
    throw error;
  }
  let response;
  try {
    response = await startAuthentication({ optionsJSON });
  } catch (error) {
    throw new Error(error.name === "NotAllowedError" ? "Fingerprint check was cancelled." : error.message);
  }
  return api("/api/sealed/open", { method: "POST", body: { code, response } });
}

/** The link a sender's QR code holds; opening it starts the unlock. */
export const sealLink = (code) => {
  const base = API_BASE || (typeof location !== "undefined" ? location.origin : "https://datachat.harmongt.uk");
  return `${base}/?seal=${encodeURIComponent(code)}`;
};

// --------------------------------------------- safety reports & account --

/** Reports a member to the admins. The server copies the message evidence. */
export async function submitReport({ reportedId, reason, details, includeMessages }) {
  return (await api("/api/reports", { method: "POST", body: { reportedId, reason, details, includeMessages } })).report;
}

export async function listMyReports() {
  return (await api("/api/reports")).reports;
}

export async function listAdminReports(status) {
  return (await api(`/api/admin/reports${status ? `?status=${encodeURIComponent(status)}` : ""}`)).reports;
}

export async function reviewAdminReport(id, status, note = "") {
  return api("/api/admin/reports", { method: "PATCH", body: { id, status, note } });
}

export async function listAdminAudit() {
  return (await api("/api/admin/audit")).events;
}

/** Everything DataChat holds about the signed-in member, as JSON. */
export async function exportMyAccount() {
  return api("/api/account/export");
}

/** Deletes the account for good; the member types their email to confirm. */
export async function deleteMyAccount(confirmEmail) {
  const result = await api("/api/account/delete", { method: "POST", body: { confirmEmail } });
  storage.set(null);
  currentUser = null;
  emit("SIGNED_OUT");
  return result;
}
