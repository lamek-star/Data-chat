import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "../../shared/api.js";
import { startEmailLogin, verifyEmailLogin } from "../../shared/auth.js";
import { createTestD1 } from "./d1-sqlite.js";

let env;
let sent;

beforeEach(() => {
  sent = [];
  env = {
    DB: createTestD1(),
    AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
    AUTH_EMAIL_FROM: "DataChat <no-reply@datachat.test>",
    EMAIL: { send: vi.fn(async (message) => (sent.push(message), { messageId: `m${sent.length}` })) },
    APP_URL: "https://datachat.test",
  };
});

const api = (path, { method = "GET", body, headers = {}, ip = "203.0.113.7" } = {}) =>
  handleApi(
    new Request(`https://datachat.test${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), "CF-Connecting-IP": ip, ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
  );
const lastCode = () => sent.at(-1).text.match(/\b(\d{8})\b/)[1];
const cookieToken = (response) => (response.headers.get("Set-Cookie") || "").match(/dc_session=([^;]*)/)?.[1];
async function signIn(email = "ana@example.test", extra = {}) {
  await api("/api/auth/email/start", { method: "POST", body: { email } });
  return api("/api/auth/email/verify", { method: "POST", body: { email, code: lastCode(), ...extra } });
}

describe("requesting a code", () => {
  it("emails an 8-digit code from the configured sender and stores only its hash", async () => {
    const r = await api("/api/auth/email/start", { method: "POST", body: { email: " Ana@Example.TEST " } });
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "DataChat <no-reply@datachat.test>", to: "ana@example.test" });
    const code = lastCode();
    expect(sent[0].subject).toContain(code);
    const row = env.DB.raw.prepare("SELECT * FROM login_codes").get();
    expect(row.email).toBe("ana@example.test");
    expect(row.code_hash).not.toContain(code);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects invalid emails", async () => {
    for (const email of ["", "nope", "a@b", "a b@c.de", `${"x".repeat(250)}@a.io`])
      expect((await api("/api/auth/email/start", { method: "POST", body: { email } })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("limits codes per email and per IP", async () => {
    for (let i = 0; i < 5; i++)
      expect((await api("/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } })).status).toBe(200);
    expect((await api("/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } })).status).toBe(429);
    for (let i = 0; i < 15; i++) await api("/api/auth/email/start", { method: "POST", body: { email: `u${i}@example.test` }, ip: "198.51.100.1" });
    expect((await api("/api/auth/email/start", { method: "POST", body: { email: "x@example.test" }, ip: "198.51.100.1" })).status).toBe(200);
    for (let i = 0; i < 5; i++) await api("/api/auth/email/start", { method: "POST", body: { email: `v${i}@example.test` }, ip: "198.51.100.1" });
    expect((await api("/api/auth/email/start", { method: "POST", body: { email: "y@example.test" }, ip: "198.51.100.1" })).status).toBe(429);
  });

  it("maps Email Service errors to clear responses", async () => {
    const fail = (code) => Object.assign(new Error("x"), { code });
    env.EMAIL.send.mockRejectedValueOnce(fail("E_RATE_LIMIT_EXCEEDED"));
    expect((await api("/api/auth/email/start", { method: "POST", body: { email: "a@example.test" } })).status).toBe(429);
    env.EMAIL.send.mockRejectedValueOnce(fail("E_RECIPIENT_SUPPRESSED"));
    expect((await api("/api/auth/email/start", { method: "POST", body: { email: "b@example.test" } })).status).toBe(400);
    env.EMAIL.send.mockRejectedValueOnce(fail("E_SENDER_DOMAIN_NOT_CONFIGURED"));
    expect((await api("/api/auth/email/start", { method: "POST", body: { email: "c@example.test" } })).status).toBe(503);
  });

  it("fails closed when the server is not configured", async () => {
    const body = { email: "a@example.test" };
    expect((await handleApi(new Request("https://x/api/auth/email/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { ...env, DB: undefined })).status).toBe(503);
    env.AUTH_SECRET = "short";
    expect((await api("/api/auth/email/start", { method: "POST", body })).status).toBe(503);
    env.AUTH_SECRET = "test-secret-that-is-at-least-32-characters-long";
    delete env.EMAIL;
    expect((await api("/api/auth/email/start", { method: "POST", body })).status).toBe(503);
  });

  it("refuses non-JSON posts (cross-site form submissions)", async () => {
    const r = await api("/api/auth/email/start", { method: "POST", body: "email=a@example.test", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(r.status).toBe(415);
  });
});

describe("verifying a code", () => {
  it("creates the account on first sign-in and sets a secure HttpOnly cookie", async () => {
    const r = await signIn("ana@example.test", { profile: { name: "Ana", username: "Ana_1", phone: "+251900000001" } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.user).toMatchObject({ email: "ana@example.test", name: "Ana", username: "ana_1", plan: "Free", role: "user", status: "active" });
    expect(body.token).toBeUndefined();
    const cookie = r.headers.get("Set-Cookie");
    expect(cookie).toMatch(/^dc_session=[A-Za-z0-9_-]{40,};/);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) expect(cookie).toContain(flag);
  });

  it("returns the token in the body only for native apps", async () => {
    const body = await (await signIn("ana@example.test", { client: "native" })).json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("never lets the sign-up form set plan, role or status", async () => {
    const body = await (await signIn("eve@example.test", { profile: { plan: "Pro", role: "admin", status: "active" } })).json();
    expect(body.user).toMatchObject({ plan: "Free", role: "user" });
  });

  it("signs an existing account back in without creating a second one", async () => {
    await signIn("ana@example.test");
    await signIn("ANA@example.test");
    expect(env.DB.raw.prepare("SELECT count(*) AS n FROM users").get().n).toBe(1);
  });

  it("rejects a wrong code and locks the code after 5 wrong tries", async () => {
    await api("/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } });
    const right = lastCode();
    const wrong = right === "00000000" ? "11111111" : "00000000";
    for (let i = 0; i < 5; i++)
      expect((await api("/api/auth/email/verify", { method: "POST", body: { email: "ana@example.test", code: wrong } })).status).toBe(401);
    expect((await api("/api/auth/email/verify", { method: "POST", body: { email: "ana@example.test", code: right } })).status).toBe(401);
  });

  it("makes codes single-use", async () => {
    await api("/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } });
    const code = lastCode();
    expect((await api("/api/auth/email/verify", { method: "POST", body: { email: "ana@example.test", code } })).status).toBe(200);
    expect((await api("/api/auth/email/verify", { method: "POST", body: { email: "ana@example.test", code } })).status).toBe(401);
  });

  it("rejects an expired code", async () => {
    const t0 = Date.UTC(2026, 10, 17, 9, 0, 0);
    await startEmailLogin(env, { email: "ana@example.test" }, t0);
    await expect(verifyEmailLogin(env, { email: "ana@example.test", code: lastCode() }, t0 + 11 * 60 * 1000)).rejects.toMatchObject({ status: 401 });
  });

  it("a newer code replaces the older one", async () => {
    await api("/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } });
    const first = lastCode();
    await api("/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } });
    const second = lastCode();
    if (first !== second)
      expect((await api("/api/auth/email/verify", { method: "POST", body: { email: "ana@example.test", code: first } })).status).toBe(401);
    expect((await api("/api/auth/email/verify", { method: "POST", body: { email: "ana@example.test", code: second } })).status).toBe(200);
  });

  it("does not leak another account's code", async () => {
    await api("/api/auth/email/start", { method: "POST", body: { email: "ana@example.test" } });
    const anasCode = lastCode();
    await api("/api/auth/email/start", { method: "POST", body: { email: "ben@example.test" } });
    expect((await api("/api/auth/email/verify", { method: "POST", body: { email: "ben@example.test", code: anasCode } })).status).toBe(lastCode() === anasCode ? 200 : 401);
  });

  it("reports a taken username clearly", async () => {
    await signIn("ana@example.test", { profile: { username: "shared" } });
    const r = await signIn("ben@example.test", { profile: { username: "SHARED" } });
    expect(r.status).toBe(409);
  });
});

describe("sessions", () => {
  it("recognises the cookie and the bearer token, and stores only a hash", async () => {
    const token = cookieToken(await signIn("ana@example.test"));
    expect((await (await api("/api/auth/session", { headers: { Cookie: `theme=dark; dc_session=${token}` } })).json()).user.email).toBe("ana@example.test");
    expect((await api("/api/auth/session", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    const stored = env.DB.raw.prepare("SELECT token_hash FROM sessions").get().token_hash;
    expect(stored).not.toBe(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects missing, forged and expired sessions", async () => {
    expect((await api("/api/auth/session")).status).toBe(401);
    expect((await api("/api/auth/session", { headers: { Authorization: "Bearer forged-token-forged-token-forged" } })).status).toBe(401);
    const token = cookieToken(await signIn("ana@example.test"));
    env.DB.raw.prepare("UPDATE sessions SET expires_at = 1").run();
    expect((await api("/api/auth/session", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("logs out by deleting the session and clearing the cookie", async () => {
    const token = cookieToken(await signIn("ana@example.test"));
    const out = await api("/api/auth/logout", { method: "POST", body: {}, headers: { Authorization: `Bearer ${token}` } });
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await api("/api/auth/session", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("suspension ends existing sessions and blocks new sign-ins", async () => {
    const token = cookieToken(await signIn("ana@example.test"));
    env.DB.raw.prepare("UPDATE users SET status = 'suspended' WHERE email = 'ana@example.test'").run();
    expect((await api("/api/auth/session", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await signIn("ana@example.test")).status).toBe(403);
  });
});
