// The admin dashboard's own host (shared/adminHost.js) and the routing that
// keeps admin features off the member app (shared/router.js).
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_ORIGIN, adminCall, adminSignIn, call, lastCode, makeEnv, setRole, signIn } from "./helpers.js";
import { ADMIN_IDLE_MS, ADMIN_SESSION_MAX_MS } from "../../shared/adminHost.js";
import { routeRequest } from "../../shared/router.js";
import { resetAccessCache } from "../../shared/access.js";

let env, ana, boss, bossCookie;
const assets = { fetch: async (request) => new Response(`asset:${new URL(request.url).pathname}`, { headers: { "Content-Type": "text/html" } }) };
beforeEach(async () => {
  env = makeEnv({ ASSETS: assets });
  ana = await signIn(env, "ana@example.test", { name: "Ana" });
  boss = await signIn(env, "boss@example.test", { name: "Boss" });
  setRole(env, "boss@example.test", "admin");
  bossCookie = await adminSignIn(env, "boss@example.test");
});
const json = (r) => r.json();

describe("admin sign-in", () => {
  it("emails codes only to administrators, with the same answer for everyone", async () => {
    const before = env.sent.length;
    const r = await adminCall(env, "/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } });
    expect(await json(r)).toEqual({ sent: true });
    const nobody = await adminCall(env, "/api/auth/email/start", { method: "POST", body: { email: "stranger@example.test" } });
    expect(await json(nobody)).toEqual({ sent: true });
    expect(env.sent.length).toBe(before); // nothing was emailed
    await adminCall(env, "/api/auth/email/start", { method: "POST", body: { email: "boss@example.test" } });
    expect(env.sent.length).toBe(before + 1);
  });

  it("never opens an admin session for a member, even with a valid code", async () => {
    await call(env, "/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } });
    const r = await adminCall(env, "/api/auth/email/verify", { method: "POST", body: { email: "ana@example.test", code: lastCode(env) } });
    expect(r.status).toBe(403);
    expect(r.headers.get("Set-Cookie")).toBeNull();
  });

  it("never creates an account", async () => {
    const count = () => env.DB.raw.prepare("SELECT COUNT(*) AS n FROM users").get().n;
    const before = count();
    await adminCall(env, "/api/auth/email/start", { method: "POST", body: { email: "new@example.test" } });
    await adminCall(env, "/api/auth/email/verify", { method: "POST", body: { email: "new@example.test", code: "12345678" } });
    expect(count()).toBe(before);
  });

  it("sets a host-only, strict, short-lived cookie and records the sign-in", async () => {
    await adminCall(env, "/api/auth/email/start", { method: "POST", body: { email: "boss@example.test" } });
    const r = await adminCall(env, "/api/auth/email/verify", { method: "POST", body: { email: "boss@example.test", code: lastCode(env) } });
    const cookie = r.headers.get("Set-Cookie");
    expect(cookie).toMatch(/^__Host-dc_admin=[A-Za-z0-9_-]{40,};/);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toContain(`Max-Age=${ADMIN_SESSION_MAX_MS / 1000}`);
    const { events } = await json(await adminCall(env, "/api/admin/audit", { cookie: bossCookie }));
    expect(events.some((e) => e.action === "admin.signin")).toBe(true);
  });
});

describe("admin sessions", () => {
  it("are separate from member sessions both ways", async () => {
    // A member/admin app session (Bearer or dc_session cookie) can't use the admin API.
    expect((await adminCall(env, "/api/admin/members", { headers: { Authorization: `Bearer ${boss.token}` } })).status).toBe(401);
    expect((await adminCall(env, "/api/admin/members", { headers: { Cookie: `dc_session=${boss.token}` } })).status).toBe(401);
    // The admin cookie means nothing to the member app.
    expect((await call(env, "/api/data", { headers: { Cookie: `__Host-dc_admin=${bossCookie}` } })).status).toBe(401);
    expect((await adminCall(env, "/api/admin/members", { cookie: bossCookie })).status).toBe(200);
  });

  it("end after 30 minutes idle and after 12 hours in any case", async () => {
    const now = Date.now();
    expect((await adminCall(env, "/api/admin/stats", { cookie: bossCookie, now: now + ADMIN_IDLE_MS - 5000 })).status).toBe(200);
    expect((await adminCall(env, "/api/admin/stats", { cookie: bossCookie, now: now + 2 * ADMIN_IDLE_MS + 10000 })).status).toBe(401);
    const fresh = await adminSignIn(env, "boss@example.test");
    // Kept busy, but past the 12-hour limit.
    env.DB.raw.prepare("UPDATE admin_sessions SET expires_at = ?").run(now - 1);
    expect((await adminCall(env, "/api/admin/stats", { cookie: fresh })).status).toBe(401);
  });

  it("stop working the moment the person is no longer an active admin", async () => {
    setRole(env, "boss@example.test", "user");
    expect((await adminCall(env, "/api/admin/members", { cookie: bossCookie })).status).toBe(401);
    setRole(env, "boss@example.test", "admin");
    const again = await adminSignIn(env, "boss@example.test");
    env.DB.raw.prepare("UPDATE users SET status = 'suspended' WHERE email = 'boss@example.test'").run();
    expect((await adminCall(env, "/api/admin/members", { cookie: again })).status).toBe(401);
  });

  it("end on sign-out", async () => {
    const r = await adminCall(env, "/api/auth/logout", { method: "POST", body: {}, cookie: bossCookie });
    expect(r.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await adminCall(env, "/api/auth/session", { cookie: bossCookie })).status).toBe(401);
  });
});

describe("cross-site protection and headers", () => {
  it("refuses writes from another site, without an Origin, or not as JSON", async () => {
    const body = { userId: ana.user.id, plan: "Pro" };
    expect((await adminCall(env, "/api/admin/members", { method: "PATCH", body, cookie: bossCookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await adminCall(env, "/api/admin/members", { method: "PATCH", body, cookie: bossCookie, origin: null })).status).toBe(403);
    expect(
      (await adminCall(env, "/api/admin/members", { method: "PATCH", cookie: bossCookie, headers: { "Content-Type": "text/plain" }, body })).status,
    ).toBe(415);
    expect((await adminCall(env, "/api/admin/members", { method: "OPTIONS", cookie: bossCookie })).status).toBe(405);
  });

  it("sends strict security headers and never lets admin data be cached or indexed", async () => {
    for (const response of [await adminCall(env, "/api/admin/stats", { cookie: bossCookie }), await adminCall(env, "/")]) {
      expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'self'");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("serves only the dashboard: no member API, service worker or app manifest", async () => {
    expect(await (await adminCall(env, "/")).text()).toBe("asset:/admin");
    expect(await (await adminCall(env, "/anything/else")).text()).toBe("asset:/admin");
    expect((await adminCall(env, "/sw.js")).status).toBe(404);
    expect((await adminCall(env, "/manifest.webmanifest")).status).toBe(404);
    expect((await adminCall(env, "/api/data", { cookie: bossCookie })).status).toBe(404);
    expect((await adminCall(env, "/api/messages", { cookie: bossCookie })).status).toBe(404);
  });
});

describe("routing by host", () => {
  const request = (url, init = {}) => routeRequest(new Request(url, init), env);
  it("sends the admin host to the dashboard and keeps admin off the member app", async () => {
    expect(await (await request(`${ADMIN_ORIGIN}/`)).text()).toBe("asset:/admin");
    const redirect = await request("https://datachat.test/admin");
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("Location")).toBe("https://admin.datachat.test/");
    expect((await request("https://datachat.test/admin.html")).status).toBe(301);
    // Even an admin's member session can't reach admin routes on the app host.
    const r = await request("https://datachat.test/api/admin/members", { headers: { Authorization: `Bearer ${boss.token}` } });
    expect(r.status).toBe(404);
    expect(await (await request("https://datachat.test/")).text()).toBe("asset:/");
  });
});

describe("dashboard numbers", () => {
  it("are counts only, and need an admin session", async () => {
    await call(env, "/api/messages", { method: "POST", token: ana.token, body: { id: crypto.randomUUID(), recipientId: boss.user.id, payload: { content: "secret text" } } });
    expect((await adminCall(env, "/api/admin/stats")).status).toBe(401);
    const { stats } = await json(await adminCall(env, "/api/admin/stats", { cookie: bossCookie }));
    expect(stats.members).toMatchObject({ total: 2, active: 2, admins: 1 });
    // Members only: the administrator isn't counted in plans or sign-ups.
    expect(stats.plans.trial + stats.plans.pro + stats.plans.free).toBe(1);
    expect(stats.signupsByWeek).toHaveLength(12);
    expect(stats.signupsByWeek.at(-1).count).toBe(1);
    expect(stats.messagesByDay).toHaveLength(14);
    expect(stats.messagesByDay.at(-1).count).toBe(1);
    expect(JSON.stringify(stats)).not.toContain("secret text");
  });
});

describe("Cloudflare Access (optional second lock)", () => {
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  let keys, jwk;
  const team = "https://datachat-team.cloudflareaccess.com";
  const sign = async (payload, kid = "k1") => {
    const head = enc({ alg: "RS256", kid, typ: "JWT" });
    const body = enc(payload);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(sig)}`;
  };
  const fetchImpl = async () => Response.json({ keys: [{ ...jwk, kid: "k1" }] });
  beforeEach(async () => {
    resetAccessCache();
    keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    Object.assign(env, { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: "aud-123" });
  });
  const valid = () => ({ iss: team, aud: ["aud-123"], email: "boss@example.test", exp: Math.floor(Date.now() / 1000) + 600 });

  it("lets through only requests that Access signed for this application", async () => {
    expect((await adminCall(env, "/", { fetchImpl })).status).toBe(403);
    const ok = await adminCall(env, "/", { fetchImpl, headers: { "Cf-Access-Jwt-Assertion": await sign(valid()) } });
    expect(ok.status).toBe(200);
    for (const bad of [
      { ...valid(), aud: ["someone-else"] },
      { ...valid(), iss: "https://evil.cloudflareaccess.com" },
      { ...valid(), exp: Math.floor(Date.now() / 1000) - 10 },
    ])
      expect((await adminCall(env, "/", { fetchImpl, headers: { "Cf-Access-Jwt-Assertion": await sign(bad) } })).status).toBe(403);
    // Signed with an unknown key.
    expect((await adminCall(env, "/", { fetchImpl, headers: { "Cf-Access-Jwt-Assertion": await sign(valid(), "k2") } })).status).toBe(403);
    // Tampered payload.
    const [h, , s] = (await sign(valid())).split(".");
    expect((await adminCall(env, "/", { fetchImpl, headers: { "Cf-Access-Jwt-Assertion": `${h}.${enc({ ...valid(), email: "x@y.z" })}.${s}` } })).status).toBe(403);
  });

  it("protects the admin API too, on top of the admin session", async () => {
    const token = await sign(valid());
    expect((await adminCall(env, "/api/admin/stats", { cookie: bossCookie, fetchImpl })).status).toBe(403);
    expect((await adminCall(env, "/api/admin/stats", { cookie: bossCookie, fetchImpl, headers: { "Cf-Access-Jwt-Assertion": token } })).status).toBe(200);
    expect((await adminCall(env, "/api/admin/stats", { fetchImpl, headers: { "Cf-Access-Jwt-Assertion": token } })).status).toBe(401);
  });
});

describe("local testing escape hatch", () => {
  it("allows exactly one extra origin, only when ADMIN_DEV_ORIGIN is set, and production never sets it", async () => {
    const { readFileSync } = await import("node:fs");
    const body = { userId: ana.user.id, plan: "Pro" };
    const local = "http://localhost:8788";
    expect((await adminCall(env, "/api/admin/members", { method: "PATCH", body, cookie: bossCookie, origin: local })).status).toBe(403);
    env.ADMIN_DEV_ORIGIN = local;
    expect((await adminCall(env, "/api/admin/members", { method: "PATCH", body, cookie: bossCookie, origin: local })).status).toBe(200);
    expect((await adminCall(env, "/api/admin/members", { method: "PATCH", body, cookie: bossCookie, origin: "http://localhost:9999" })).status).toBe(403);
    expect(readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8")).not.toContain("ADMIN_DEV_ORIGIN");
  });
});
