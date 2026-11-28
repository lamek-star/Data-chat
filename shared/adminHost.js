// The admin dashboard's own host (admin.datachat.harmongt.uk). Everything
// administrative lives here and nowhere else:
//  - the member app's host refuses /api/admin/* and redirects /admin here,
//  - this host serves only the dashboard and the admin API (no member API),
//  - sign-in codes are emailed only to existing administrators, and verifying
//    one never creates an account,
//  - sessions are separate from member sessions: a host-only, SameSite=Strict
//    cookie (__Host-dc_admin), 12 hours at most and 30 minutes idle,
//  - writes must be JSON from this exact origin (no cross-site requests),
//  - strict security headers, no caching, not indexed by search engines,
//  - optional Cloudflare Access check on every request (shared/access.js).
import {
  AuthError,
  consumeLoginCode,
  issueLoginCode,
  newSessionToken,
  normalizeEmail,
  publicUser,
  requireConfig,
  sha256,
} from "./auth.js";
import { ApiError, adminCreateCode, adminListCodes, adminListMembers, adminSetMember } from "./data.js";
import { adminListReports, adminReviewReport } from "./safety.js";
import { listAudit, recordAudit } from "./audit.js";
import { adminStats } from "./adminStats.js";
import { adminCreateCommunity, adminListCommunities, adminListOffers, adminReviewOffer, adminSetCommunity } from "./community.js";
import { requestLocation } from "./email.js";
import { accessConfigured, verifyAccess } from "./access.js";

export const DEFAULT_ADMIN_HOST = "admin.datachat.harmongt.uk";
const ADMIN_COOKIE = "__Host-dc_admin";
export const ADMIN_SESSION_MAX_MS = 12 * 60 * 60 * 1000;
export const ADMIN_IDLE_MS = 30 * 60 * 1000;
const MAX_JSON_BYTES = 64_000;

export function adminHosts(env) {
  const extra = String(env.ADMIN_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([String(env.ADMIN_HOST || DEFAULT_ADMIN_HOST).toLowerCase(), ...extra]);
}
export const isAdminHost = (env, hostname) => adminHosts(env).has(String(hostname).toLowerCase());
export const primaryAdminHost = (env) => String(env.ADMIN_HOST || DEFAULT_ADMIN_HOST);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function withSecurityHeaders(response, { noStore = true } = {}) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (noStore) headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const json = (body, status = 200, headers = {}) => withSecurityHeaders(Response.json(body, { status, headers }));

const adminCookie = (token) => `${ADMIN_COOKIE}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ADMIN_SESSION_MAX_MS / 1000}`;
const clearAdminCookie = () => `${ADMIN_COOKIE}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

function cookieToken(request) {
  const match = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)__Host-dc_admin=([A-Za-z0-9_-]{20,})/);
  return match ? match[1] : "";
}

/** The signed-in administrator for this request, or null. */
export async function adminSessionUser(env, request, now = Date.now()) {
  const token = cookieToken(request);
  if (!token || !env.DB) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT u.*, s.expires_at AS session_expires, s.last_seen_at AS session_seen FROM admin_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
  ).bind(tokenHash).first();
  const expired = !row || row.session_expires <= now || now - row.session_seen > ADMIN_IDLE_MS;
  if (expired || row.role !== "admin" || row.status !== "active") {
    if (row) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  if (now - row.session_seen > 60 * 1000)
    await env.DB.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
  return row;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new ApiError(413, "Request too large.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "Invalid JSON.");
  }
}

async function adminApi(request, env, url, now) {
  const { pathname } = url;
  const m = request.method;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (pathname === "/api/auth/email/start" && m === "POST") {
    requireConfig(env);
    const email = normalizeEmail((await readJson(request)).email);
    const admin = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND role = 'admin' AND status = 'active'").bind(email).first();
    // Same answer either way, so the form can't be used to find admin emails
    // or to email codes to strangers. Rate limits apply to both.
    await issueLoginCode(env, email, { ip, location: requestLocation(request.cf), send: Boolean(admin) }, now);
    return json({ sent: true });
  }
  if (pathname === "/api/auth/email/verify" && m === "POST") {
    requireConfig(env);
    const body = await readJson(request);
    const email = await consumeLoginCode(env, body.email, body.code, ip, now);
    const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    if (!user || user.role !== "admin" || user.status !== "active")
      throw new AuthError(403, "This account can't use the admin dashboard.");
    const token = newSessionToken();
    await env.DB.batch([
      // Old sessions of this admin that have expired are cleared on sign-in.
      env.DB.prepare("DELETE FROM admin_sessions WHERE user_id = ? AND (expires_at <= ? OR last_seen_at <= ?)").bind(user.id, now, now - ADMIN_IDLE_MS),
      env.DB.prepare("INSERT INTO admin_sessions (token_hash, user_id, expires_at, created_at, last_seen_at, ip) VALUES (?, ?, ?, ?, ?, ?)").bind(
        await sha256(token),
        user.id,
        now + ADMIN_SESSION_MAX_MS,
        now,
        now,
        ip,
      ),
    ]);
    await recordAudit(env, user, "admin.signin", user.id, { ip, location: requestLocation(request.cf) });
    return json({ user: publicUser(user), idleMinutes: ADMIN_IDLE_MS / 60000 }, 200, { "Set-Cookie": adminCookie(token) });
  }

  const user = await adminSessionUser(env, request, now);
  if (pathname === "/api/auth/session" && m === "GET")
    return user ? json({ user: publicUser(user), idleMinutes: ADMIN_IDLE_MS / 60000 }) : json({ error: "Not signed in." }, 401);
  if (pathname === "/api/auth/logout" && m === "POST") {
    const token = cookieToken(request);
    if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    return json({ signedOut: true }, 200, { "Set-Cookie": clearAdminCookie() });
  }

  if (!/^\/api\/admin\/(stats|members|codes|reports|audit|offers|communities)$/.test(pathname)) return json({ error: "Not found." }, 404);
  if (!user) return json({ error: "Your admin session has ended. Sign in again." }, 401);

  if (pathname === "/api/admin/stats" && m === "GET") return json({ stats: await adminStats(env, user, now) });
  if (pathname === "/api/admin/members" && m === "GET") return json({ members: await adminListMembers(env, user) });
  if (pathname === "/api/admin/members" && m === "PATCH") return json(await adminSetMember(env, user, await readJson(request)));
  if (pathname === "/api/admin/codes" && m === "GET") return json({ codes: await adminListCodes(env, user) });
  if (pathname === "/api/admin/codes" && m === "POST") return json({ code: await adminCreateCode(env, user, (await readJson(request)).code) });
  if (pathname === "/api/admin/reports" && m === "GET") return json({ reports: await adminListReports(env, user, url.searchParams.get("status")) });
  if (pathname === "/api/admin/reports" && m === "PATCH") return json(await adminReviewReport(env, user, await readJson(request)));
  if (pathname === "/api/admin/audit" && m === "GET") return json({ events: await listAudit(env, url.searchParams.get("limit")) });
  if (pathname === "/api/admin/offers" && m === "GET") return json({ offers: await adminListOffers(env, user, url.searchParams.get("status"), now) });
  if (pathname === "/api/admin/offers" && m === "PATCH") return json(await adminReviewOffer(env, user, await readJson(request), now));
  if (pathname === "/api/admin/communities" && m === "GET") return json({ communities: await adminListCommunities(env, user) });
  if (pathname === "/api/admin/communities" && m === "POST") return json(await adminCreateCommunity(env, user, await readJson(request), now));
  if (pathname === "/api/admin/communities" && m === "PATCH") return json(await adminSetCommunity(env, user, await readJson(request)));
  return json({ error: "Method not allowed." }, 405);
}

const DENIED_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access denied</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0c0a09;color:#e7e2dc;font:16px system-ui,sans-serif"><main style="text-align:center;padding:24px"><h1 style="font-size:22px">Access denied</h1><p style="color:#a8a29e">This dashboard is restricted.</p></main>`;

/** Handles every request that arrives on the admin host. */
export async function handleAdminHost(request, env, { now = Date.now(), fetchImpl } = {}) {
  const url = new URL(request.url);
  try {
    // Optional Cloudflare Access: refuse anything Access didn't let through.
    if (accessConfigured(env) && !(await verifyAccess(request, env, { fetchImpl, now }))) {
      return url.pathname.startsWith("/api/")
        ? json({ error: "Access denied." }, 403)
        : withSecurityHeaders(new Response(DENIED_PAGE, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }));
    }

    if (url.pathname.startsWith("/api/")) {
      // Same-origin only: no CORS, and writes must come from this page as JSON.
      if (request.method === "OPTIONS") return json({ error: "Not allowed." }, 405);
      if (!["GET", "HEAD"].includes(request.method)) {
        // ADMIN_DEV_ORIGIN: local testing only (wrangler dev rewrites the URL
        // to the production host while the browser is on localhost). Never set
        // in production; it allows exactly one extra origin.
        const origin = request.headers.get("Origin");
        if (origin !== url.origin && !(env.ADMIN_DEV_ORIGIN && origin === env.ADMIN_DEV_ORIGIN))
          return json({ error: "Cross-site request refused." }, 403);
        if (!(request.headers.get("Content-Type") || "").includes("application/json")) return json({ error: "Send JSON." }, 415);
      }
      return await adminApi(request, env, url, now);
    }

    // Nothing from the member app here: no service worker, no app manifest.
    if (["/sw.js", "/manifest.webmanifest", "/.well-known/assetlinks.json"].includes(url.pathname))
      return withSecurityHeaders(new Response("Not found", { status: 404 }));
    if (url.pathname.startsWith("/assets/")) return env.ASSETS.fetch(request);
    // Every page on this host is the dashboard.
    const page = await env.ASSETS.fetch(new Request(new URL("/admin", url), { headers: request.headers }));
    return withSecurityHeaders(page);
  } catch (error) {
    if (error instanceof AuthError || error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error("DataChat admin error", url.pathname, error.message);
    return json({ error: "The server could not complete this request." }, 500);
  }
}
