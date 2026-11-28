// Password sign-in and recovery (shared/password.js, src/lib/passwordKey.js).
import { beforeEach, describe, expect, it } from "vitest";
import { call, lastCode, makeEnv } from "./helpers.js";
import { derivePasswordKey, passwordProblem } from "../../src/lib/passwordKey.js";

let env;
beforeEach(() => {
  env = makeEnv();
});
const json = (r) => r.json();
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const KEY_C = "c".repeat(64);

async function register(email, key, profile = { name: "Sara" }) {
  await call(env, "/api/auth/email/start", { method: "POST", body: { email } });
  const r = await call(env, "/api/auth/email/verify", { method: "POST", body: { email, code: lastCode(env), profile, passwordKey: key, client: "native" } });
  expect(r.status).toBe(200);
  return json(r);
}
const login = (email, key, ip) => call(env, "/api/auth/password/login", { method: "POST", body: { email, key, client: "native" }, ip });

describe("password sign-in", () => {
  it("lets a member choose a password at sign-up and sign in with it later, no email code", async () => {
    const first = await register("sara@example.test", KEY_A);
    expect(first.user.hasPassword).toBe(true);
    const sentBefore = env.sent.length;
    const r = await login("SARA@example.test", KEY_A);
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.user.email).toBe("sara@example.test");
    expect((await call(env, "/api/data", { token: body.token })).status).toBe(200);
    expect(env.sent.length).toBe(sentBefore); // no email sent
  });

  it("gives the same answer for a wrong password, an unknown email and an account without a password", async () => {
    await register("sara@example.test", KEY_A);
    await register("nopass@example.test", undefined);
    const answers = [];
    for (const [email, key] of [["sara@example.test", KEY_B], ["nobody@example.test", KEY_A], ["nopass@example.test", KEY_A]]) {
      const r = await login(email, key);
      answers.push([r.status, (await json(r)).error]);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0][0]).toBe(401);
  });

  it("never stores the key itself", async () => {
    await register("sara@example.test", KEY_A);
    const row = env.DB.raw.prepare("SELECT password_hash FROM users WHERE email = 'sara@example.test'").get();
    expect(row.password_hash).toMatch(/^v1\$[A-Za-z0-9_-]{16,}\$[0-9a-f]{64}$/);
    expect(row.password_hash).not.toContain(KEY_A);
  });

  it("stops guessing after a few tries", async () => {
    await register("sara@example.test", KEY_A);
    for (let i = 0; i < 8; i++) expect((await login("sara@example.test", KEY_B, `198.51.100.${i}`)).status).toBe(401);
    expect((await login("sara@example.test", KEY_A, "198.51.100.99")).status).toBe(429); // even the right one, for now
  });

  it("refuses suspended members and malformed keys", async () => {
    await register("sara@example.test", KEY_A);
    env.DB.raw.prepare("UPDATE users SET status = 'suspended' WHERE email = 'sara@example.test'").run();
    expect((await login("sara@example.test", KEY_A)).status).toBe(403);
    await register("ben@example.test", KEY_A);
    expect((await login("ben@example.test", "short")).status).toBe(401);
  });

  it("doesn't let a sign-in with an email code overwrite an existing password", async () => {
    await register("sara@example.test", KEY_A);
    await register("sara@example.test", KEY_B); // code sign-in sending another key
    expect((await login("sara@example.test", KEY_A)).status).toBe(200);
    expect((await login("sara@example.test", KEY_B)).status).toBe(401);
  });
});

describe("forgot password", () => {
  it("resets with an emailed code, signs in, and signs out every old session", async () => {
    const old = await register("sara@example.test", KEY_A);
    const other = await json(await login("sara@example.test", KEY_A));
    await call(env, "/api/auth/email/start", { method: "POST", body: { email: "sara@example.test" } });
    const r = await call(env, "/api/auth/password/reset", { method: "POST", body: { email: "sara@example.test", code: lastCode(env), key: KEY_B, client: "native" } });
    expect(r.status).toBe(200);
    const fresh = await json(r);
    expect((await call(env, "/api/data", { token: fresh.token })).status).toBe(200);
    expect((await call(env, "/api/data", { token: old.token })).status).toBe(401);
    expect((await call(env, "/api/data", { token: other.token })).status).toBe(401);
    expect((await login("sara@example.test", KEY_A)).status).toBe(401);
    expect((await login("sara@example.test", KEY_B)).status).toBe(200);
  });

  it("needs the right code, used once", async () => {
    await register("sara@example.test", KEY_A);
    await call(env, "/api/auth/email/start", { method: "POST", body: { email: "sara@example.test" } });
    const code = lastCode(env);
    const wrong = code === "12345678" ? "87654321" : "12345678";
    expect((await call(env, "/api/auth/password/reset", { method: "POST", body: { email: "sara@example.test", code: wrong, key: KEY_B } })).status).toBe(401);
    expect((await call(env, "/api/auth/password/reset", { method: "POST", body: { email: "sara@example.test", code, key: KEY_B } })).status).toBe(200);
    expect((await call(env, "/api/auth/password/reset", { method: "POST", body: { email: "sara@example.test", code, key: KEY_C } })).status).toBe(401);
    expect((await login("sara@example.test", KEY_B)).status).toBe(200);
  });
});

describe("changing the password in Settings", () => {
  it("needs the current password once the session isn't brand new; signs out other devices", async () => {
    const me = await register("sara@example.test", KEY_A);
    const otherDevice = await json(await login("sara@example.test", KEY_A));
    // Make this session look older than 10 minutes.
    env.DB.raw.prepare("UPDATE sessions SET created_at = created_at - 3600000").run();
    const set = (body) => call(env, "/api/auth/password/set", { method: "POST", body, token: me.token });
    expect((await set({ key: KEY_B })).status).toBe(401);
    expect((await set({ key: KEY_B, currentKey: KEY_C })).status).toBe(401);
    expect((await set({ key: KEY_B, currentKey: KEY_A })).status).toBe(200);
    expect((await call(env, "/api/data", { token: me.token })).status).toBe(200); // this device stays signed in
    expect((await call(env, "/api/data", { token: otherDevice.token })).status).toBe(401);
    expect((await login("sara@example.test", KEY_B)).status).toBe(200);
  });

  it("lets an account without a password set one right after signing in", async () => {
    const me = await register("nopass@example.test", undefined);
    expect(me.user.hasPassword).toBe(false);
    expect((await call(env, "/api/auth/password/set", { method: "POST", body: { key: KEY_A }, token: me.token })).status).toBe(200);
    expect((await login("nopass@example.test", KEY_A)).status).toBe(200);
    expect((await call(env, "/api/auth/password/set", { method: "POST", body: { key: KEY_A } })).status).toBe(401);
  });
});

describe("on the device", () => {
  it("derives the same 64-character key for the same email and password, different otherwise", async () => {
    const a = await derivePasswordKey("Sara@Example.test ", "correct horse", 1000);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await derivePasswordKey("sara@example.test", "correct horse", 1000)).toBe(a);
    expect(await derivePasswordKey("ben@example.test", "correct horse", 1000)).not.toBe(a);
    expect(await derivePasswordKey("sara@example.test", "correct horsf", 1000)).not.toBe(a);
  });
  it("explains weak passwords", () => {
    expect(passwordProblem("short")).toMatch(/8 characters/);
    expect(passwordProblem("password123")).toMatch(/common/);
    expect(passwordProblem("aaaaaaaaaa")).toMatch(/repeat/);
    expect(passwordProblem("sarasara99", "sara@example.test")).toMatch(/email/);
    expect(passwordProblem("Teff-Injera-2026")).toBe("");
  });
});
