// Password sign-in for members.
//
// The app never sends the password. It stretches it on the device
// (PBKDF2-SHA256, 310,000 rounds, salted with the email address) and sends
// the 32-byte result (`key`, 64 hex characters). The server then stores
//   v1$<random salt>$HMAC-SHA256(pepper, salt || key)
// where the pepper is derived from AUTH_SECRET and never stored in the
// database. A leaked database therefore needs the server secret and 310,000
// rounds per guess, while the server's own work stays tiny (Workers CPU).
//
// Recovery: an emailed code (shared/auth.js) proves the address, then a new
// password replaces the old one and every other session is signed out.
import { AuthError, allow, consumeLoginCode, createSession, hmac, normalizeEmail, requireConfig, sameHex, sha256 } from "./auth.js";

const KEY = /^[0-9a-f]{64}$/;
const FRESH_SIGN_IN_MS = 10 * 60 * 1000; // a sign-in this recent may set a password without the old one
const LIMITS = {
  loginPerEmail: [8, 15 * 60 * 1000],
  loginPerIp: [40, 60 * 60 * 1000],
  changePerUser: [10, 60 * 60 * 1000],
};

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function requireKey(key) {
  const value = String(key ?? "").toLowerCase();
  if (!KEY.test(value)) throw new AuthError(400, "Update DataChat and try again.");
  return value;
}

async function pepper(env) {
  return hmac(env.AUTH_SECRET, "datachat-password-pepper-v1");
}

export async function hashPassword(env, key, salt = b64url(crypto.getRandomValues(new Uint8Array(16)))) {
  return `v1$${salt}$${await hmac(await pepper(env), `${salt}:${requireKey(key)}`)}`;
}

export async function passwordMatches(env, stored, key) {
  const [version, salt, digest] = String(stored || "").split("$");
  if (version !== "v1" || !salt || !digest || !KEY.test(String(key ?? "").toLowerCase())) return false;
  return sameHex(await hmac(await pepper(env), `${salt}:${String(key).toLowerCase()}`), digest);
}

/** Saves a new password for this user; returns the updated row. */
export async function setPassword(env, user, key, now = Date.now()) {
  const hash = await hashPassword(env, key);
  await env.DB.prepare("UPDATE users SET password_hash = ?, password_updated_at = ? WHERE id = ?").bind(hash, now, user.id).run();
  return { ...user, password_hash: hash, password_updated_at: now };
}

async function signOutOthers(env, userId, keepToken) {
  const keep = keepToken ? await sha256(keepToken) : "";
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").bind(userId, keep),
    env.DB.prepare("DELETE FROM admin_sessions WHERE user_id = ?").bind(userId),
  ]);
}

/** Email + password sign-in. One answer for every failure, so it can't be used to find accounts. */
export async function passwordLogin(env, { email: rawEmail, key, ip = "unknown" }, now = Date.now()) {
  requireConfig(env);
  const email = normalizeEmail(rawEmail);
  if (!(await allow(env, `pw:ip:${ip}`, LIMITS.loginPerIp, now)) || !(await allow(env, `pw:email:${email}`, LIMITS.loginPerEmail, now)))
    throw new AuthError(429, "Too many sign-in attempts. Wait 15 minutes, or use “Forgot password”.");
  const wrong = new AuthError(401, "Email or password is wrong. Try again, or use “Forgot password”.");
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  // Do the same work whether or not the account exists (no timing hint).
  const ok = await passwordMatches(env, user?.password_hash || `v1$AAAAAAAAAAAAAAAAAAAAAA$${"0".repeat(64)}`, key);
  if (!user || !user.password_hash || !ok) throw wrong;
  if (user.status === "suspended") throw new AuthError(403, "This account is suspended. Contact support.");
  return createSession(env, user, now);
}

/** Forgot password: the emailed code proves the address; the new password replaces the old one. */
export async function resetPassword(env, { email, code, key, ip = "unknown" }, now = Date.now()) {
  requireConfig(env);
  requireKey(key);
  const verified = await consumeLoginCode(env, email, code, ip, now);
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(verified).first();
  if (!user) throw new AuthError(401, "The code is wrong or has expired. Request a new one.");
  if (user.status === "suspended") throw new AuthError(403, "This account is suspended. Contact support.");
  const updated = await setPassword(env, user, key, now);
  await signOutOthers(env, user.id, null); // every old session, on every device
  return createSession(env, updated, now);
}

/**
 * Set or change the password while signed in. Changing it needs the current
 * password, unless this session started minutes ago (just signed in).
 */
export async function changePassword(env, user, { key, currentKey } = {}, keepToken, now = Date.now()) {
  if (!(await allow(env, `pw:change:${user.id}`, LIMITS.changePerUser, now))) throw new AuthError(429, "Too many attempts. Wait a while and try again.");
  requireKey(key);
  if (user.password_hash) {
    const fresh = Number(user.session_created) > 0 && now - Number(user.session_created) < FRESH_SIGN_IN_MS && !currentKey;
    if (!fresh && !(await passwordMatches(env, user.password_hash, currentKey))) throw new AuthError(401, "Your current password is wrong.");
  }
  await setPassword(env, user, key, now);
  await signOutOthers(env, user.id, keepToken);
  return { saved: true };
}
