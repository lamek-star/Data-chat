// Email-code sign-in on Cloudflare: D1 for accounts/codes/sessions and the
// Email Service binding for sending codes. No passwords are stored.
//
// Flow: POST /api/auth/email/start {email} -> code emailed (10 min, 5 tries)
//       POST /api/auth/email/verify {email, code} -> session (30 days)
// Web clients get an HttpOnly cookie; native apps ask for the token in the
// body ({"client":"native"}) and keep it in secure storage.
//
// Configuration:
//   DB                D1 binding (migrations/0001_auth.sql)
//   EMAIL             send_email binding (Cloudflare Email Service)
//   AUTH_SECRET       secret, 32+ random characters (HMAC key for codes)
//   AUTH_EMAIL_FROM   e.g. "DataChat <no-reply@datachat.harmongt.uk>"
//   DEV_LOG_EMAIL_CODES=1  local development only: log codes instead of sending

import { loginCodeEmail } from "./email.js";
import { sendSmtp } from "./smtp.js";

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TRIAL_MS = 90 * 24 * 60 * 60 * 1000; // free Pro for new members
const MAX_CODE_ATTEMPTS = 5;
const SESSION_COOKIE = "dc_session";
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const LIMITS = {
  startPerEmail: [5, 60 * 60 * 1000],
  startPerIp: [20, 60 * 60 * 1000],
  verifyPerIp: [30, 60 * 60 * 1000],
};

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const encoder = new TextEncoder();
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new AuthError(400, "Enter a valid email address.");
  return email;
}

function randomDigits(length) {
  // Rejection sampling: each digit uniform in 0-9.
  let out = "";
  const buffer = new Uint8Array(1);
  while (out.length < length) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < 250) out += String(buffer[0] % 10);
  }
  return out;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export const sha256 = async (text) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));

function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function requireConfig(env) {
  if (!env.DB) throw new AuthError(503, "Sign-in is not configured on the server (no database).");
  if (!env.AUTH_SECRET || String(env.AUTH_SECRET).length < 32)
    throw new AuthError(503, "Sign-in is not configured on the server (AUTH_SECRET).");
}

// Fixed-window counter. Returns false when the limit is reached.
async function allow(env, key, [limit, windowMs], now) {
  const row = await env.DB.prepare("SELECT window_start, count FROM rate_limits WHERE key = ?").bind(key).first();
  if (!row || now - row.window_start >= windowMs) {
    await env.DB.prepare(
      "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1",
    ).bind(key, now).run();
    return true;
  }
  if (row.count >= limit) return false;
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
  return true;
}

async function sendCodeEmail(env, email, code, location) {
  // Preferred: the owner's Gmail account (App Password), which can email anyone.
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    const message = loginCodeEmail({ code, appUrl: env.APP_URL, location, minutes: CODE_TTL_MS / 60000 });
    try {
      await sendSmtp({
        connect: env.SMTP_CONNECT,
        username: String(env.GMAIL_USER).trim(),
        password: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, ""), // Google shows it in groups of 4
        to: email,
        ...message,
      });
      return;
    } catch (error) {
      console.error("Gmail login email failed", error.code, error.message);
      if (error.code === 534 || error.code === 535)
        throw new AuthError(503, "The sign-in email could not be sent (mail account setup). Contact support.");
      if (/5\.4\.5|limit/i.test(error.message))
        throw new AuthError(429, "Too many emails today. Try again later.");
      if (error.code === 550 || error.code === 553)
        throw new AuthError(400, "That email address doesn't seem to exist. Check it and try again.");
      throw new AuthError(503, "The sign-in email could not be sent. Try again shortly.");
    }
  }
  if (env.EMAIL) {
    const message = loginCodeEmail({ code, appUrl: env.APP_URL, location, minutes: CODE_TTL_MS / 60000 });
    try {
      await env.EMAIL.send({ from: env.AUTH_EMAIL_FROM, to: email, ...message });
      return;
    } catch (error) {
      console.error("Login email failed", error.code || error.name, error.message);
      if (error.code === "E_RATE_LIMIT_EXCEEDED" || error.code === "E_DAILY_LIMIT_EXCEEDED")
        throw new AuthError(429, "Too many emails right now. Try again in a few minutes.");
      if (error.code === "E_RECIPIENT_SUPPRESSED")
        throw new AuthError(400, "Email to this address is blocked. Use a different address.");
      // Free Email Routing only delivers to verified addresses.
      if (error.code === "E_RECIPIENT_NOT_ALLOWED" || error.code === "E_RECIPIENT_PLAN_RESTRICTED")
        throw new AuthError(400, "DataChat can't send codes to this address yet. Contact support.");
      throw new AuthError(503, "The sign-in email could not be sent. Try again shortly.");
    }
  }
  if (env.DEV_LOG_EMAIL_CODES === "1") {
    console.info(`[dev] DataChat code for ${email}: ${code}`);
    return;
  }
  throw new AuthError(503, "Sign-in email is not configured on the server.");
}

/** Step 1: email a fresh code. The response is the same whether or not the account exists. */
export async function startEmailLogin(env, { email: rawEmail, ip = "unknown", location = "" }, now = Date.now()) {
  requireConfig(env);
  const email = normalizeEmail(rawEmail);
  await issueLoginCode(env, email, { ip, location }, now);
  return { sent: true };
}

/** Rate-limited: stores a fresh one-time code for this address and emails it. */
export async function issueLoginCode(env, email, { ip = "unknown", location = "", send = true } = {}, now = Date.now()) {
  if (!(await allow(env, `start:ip:${ip}`, LIMITS.startPerIp, now)) || !(await allow(env, `start:email:${email}`, LIMITS.startPerEmail, now)))
    throw new AuthError(429, "Too many codes requested. Wait a while and try again.");
  if (!send) return; // counted against the limits, but nothing is sent
  const code = randomDigits(8);
  await env.DB.prepare(
    "INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?) " +
      "ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at",
  ).bind(email, await hmac(env.AUTH_SECRET, `${email}:${code}`), now + CODE_TTL_MS, now).run();
  await sendCodeEmail(env, email, code, location);
}

function newContactCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % 32]).join("");
}

const cleanText = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);

async function findOrCreateUser(env, email, profile = {}, now = Date.now()) {
  const existing = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (existing) return existing;
  const username = cleanText(profile.username, 24).toLowerCase();
  const user = {
    id: crypto.randomUUID(),
    email,
    username: /^[a-z0-9._-]{3,24}$/.test(username) ? username : null,
    display_name: cleanText(profile.name, 80) || email.split("@")[0],
    phone: cleanText(profile.phone, 32),
    country: cleanText(profile.country, 56) || "Global",
    contact_code: newContactCode(),
  };
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, email, username, display_name, phone, country, contact_code, pro_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(user.id, user.email, user.username, user.display_name, user.phone, user.country, user.contact_code, now + TRIAL_MS).run();
  } catch (error) {
    if (/UNIQUE/i.test(error.message) && /username/i.test(error.message))
      throw new AuthError(409, "That username is taken. Choose another one.");
    throw error;
  }
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
}

/**
 * The plan a member actually has right now: permanent Pro (paid, cash code,
 * admin) or Pro during the free trial; otherwise Free.
 */
export function effectivePlan(row, now = Date.now()) {
  if (row.plan === "Pro") return { plan: "Pro", trial: false, proUntil: null };
  const until = Number(row.pro_until) || 0;
  return until > now ? { plan: "Pro", trial: true, proUntil: until } : { plan: "Free", trial: false, proUntil: until || null };
}

/** What the client may see about the signed-in account. */
export const publicUser = (row, now = Date.now()) => {
  const { plan, trial, proUntil } = effectivePlan(row, now);
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    name: row.display_name,
    phone: row.phone,
    country: row.country,
    contactCode: row.contact_code,
    avatarUrl: row.avatar_url ?? null,
    plan,
    trial,
    proUntil: proUntil ? new Date(proUntil).toISOString() : null,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
};

/** Step 2: check the code and open a session. Creates the account on first sign-in. */
export async function verifyEmailLogin(env, { email: rawEmail, code: rawCode, profile, ip = "unknown" }, now = Date.now()) {
  requireConfig(env);
  const email = await consumeLoginCode(env, rawEmail, rawCode, ip, now);
  const user = await findOrCreateUser(env, email, profile, now);
  if (user.status === "suspended") throw new AuthError(403, "This account is suspended. Contact support.");
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(await sha256(token), user.id, now + SESSION_TTL_MS, now, now).run();
  return { token, user: publicUser(user), expiresAt: now + SESSION_TTL_MS };
}

/** Checks and uses up the emailed code (single use, 5 tries). Returns the email. */
export async function consumeLoginCode(env, rawEmail, rawCode, ip = "unknown", now = Date.now()) {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode ?? "").replace(/\D/g, "");
  if (!(await allow(env, `verify:ip:${ip}`, LIMITS.verifyPerIp, now)))
    throw new AuthError(429, "Too many attempts. Wait a while and try again.");
  const wrong = new AuthError(401, "The code is wrong or has expired. Request a new one.");
  const pending = await env.DB.prepare("SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?").bind(email).first();
  if (!pending || pending.expires_at <= now || code.length !== 8) throw wrong;
  if (pending.attempts >= MAX_CODE_ATTEMPTS) {
    await env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(email).run();
    throw wrong;
  }
  if (!sameHex(await hmac(env.AUTH_SECRET, `${email}:${code}`), pending.code_hash)) {
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
    throw wrong;
  }
  // Single use: delete before anything else can reuse it.
  const consumed = await env.DB.prepare("DELETE FROM login_codes WHERE email = ? AND code_hash = ?").bind(email, pending.code_hash).run();
  if (!consumed.meta?.changes) throw wrong;
  return email;
}

export const newSessionToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

function sessionToken(request) {
  const header = request.headers.get("Authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)dc_session=([A-Za-z0-9_-]{20,})/);
  return match ? match[1] : "";
}

/** The signed-in, active user for this request, or null. */
export async function sessionUser(env, request, now = Date.now()) {
  if (!env.DB) return null;
  const token = sessionToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT u.*, s.expires_at AS session_expires, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
  ).bind(tokenHash).first();
  if (!row || row.session_expires <= now) return null;
  if (row.status !== "active") return null;
  if (now - row.last_seen_at > 60 * 60 * 1000)
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
  return row;
}

export async function endSession(env, request) {
  const token = sessionToken(request);
  if (env.DB && token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export const sessionCookie = (token, maxAgeSeconds = SESSION_TTL_MS / 1000) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
export const clearSessionCookie = () => `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
