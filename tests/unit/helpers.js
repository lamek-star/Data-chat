// Shared test setup: a D1 stand-in, a fake Email Service binding that
// records sent codes, and a shortcut to sign a member in.
import { vi } from "vitest";
import { handleApi } from "../../shared/api.js";
import { handleAdminHost } from "../../shared/adminHost.js";
import { createTestD1 } from "./d1-sqlite.js";

export function makeEnv(extra = {}) {
  const sent = [];
  return {
    DB: createTestD1(),
    AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
    AUTH_EMAIL_FROM: "DataChat <no-reply@datachat.test>",
    EMAIL: { send: vi.fn(async (message) => (sent.push(message), { messageId: `m${sent.length}` })) },
    APP_URL: "https://datachat.test",
    ADMIN_HOST: "admin.datachat.test",
    sent,
    ...extra,
  };
}

/** The 8-digit sign-in code in the last email sent. */
export const lastCode = (env) => env.sent.at(-1).text.match(/(?:^|\D)(\d{8})(?!\d)/)[1];

/** Calls the API like the app does. `token` signs the request as that member. */
export function call(env, path, { method = "GET", body, token, headers = {}, ip = "203.0.113.7", deps } = {}) {
  const isRaw = body instanceof Uint8Array || typeof body === "string";
  return handleApi(
    new Request(`https://datachat.test${path}`, {
      method,
      headers: {
        ...(body !== undefined && !isRaw ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "CF-Connecting-IP": ip,
        ...headers,
      },
      body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body),
    }),
    env,
    deps,
  );
}

/** Signs in through the real email-code flow; returns { token, user }. */
export async function signIn(env, email, profile = {}) {
  await call(env, "/api/auth/email/start", { method: "POST", body: { email } });
  const code = lastCode(env);
  const response = await call(env, "/api/auth/email/verify", { method: "POST", body: { email, code, profile, client: "native" } });
  if (response.status !== 200) throw new Error(`sign-in failed: ${response.status} ${await response.text()}`);
  return response.json();
}

export const setRole = (env, email, role) => env.DB.raw.prepare("UPDATE users SET role = ? WHERE email = ?").run(role, email);

export const ADMIN_ORIGIN = "https://admin.datachat.test";

/** Calls the admin dashboard's host. `cookie` is the admin session cookie value. */
export function adminCall(env, path, { method = "GET", body, cookie, origin = ADMIN_ORIGIN, ip = "203.0.113.9", headers = {}, now, fetchImpl } = {}) {
  const writing = !["GET", "HEAD"].includes(method);
  return handleAdminHost(
    new Request(`${ADMIN_ORIGIN}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: `__Host-dc_admin=${cookie}` } : {}),
        ...(writing && origin ? { Origin: origin } : {}),
        "CF-Connecting-IP": ip,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    { now, fetchImpl },
  );
}

/** Signs an administrator in to the admin host; returns the session cookie value. */
export async function adminSignIn(env, email) {
  const before = env.sent.length;
  await adminCall(env, "/api/auth/email/start", { method: "POST", body: { email } });
  if (env.sent.length === before) throw new Error("no admin code was sent");
  const response = await adminCall(env, "/api/auth/email/verify", { method: "POST", body: { email, code: lastCode(env) } });
  if (response.status !== 200) throw new Error(`admin sign-in failed: ${response.status} ${await response.text()}`);
  return response.headers.get("Set-Cookie").match(/__Host-dc_admin=([^;]+)/)[1];
}
