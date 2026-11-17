import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "../../shared/api.js";

const USER = "11111111-2222-3333-4444-555555555555";
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_PRO_PRICE_ID: "price_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  APP_URL: "https://datachat.example",
};

let calls;
let validToken;
function fakeSupabase(url, init = {}) {
  url = String(url);
  calls.push({ url, init });
  if (url.endsWith("/rest/v1/rpc/datachat_login_email")) {
    const { requested_username } = JSON.parse(init.body);
    return new Response(JSON.stringify(requested_username === "abel" ? "abel@example.com" : null));
  }
  if (url.includes("/auth/v1/token")) {
    const { password } = JSON.parse(init.body);
    if (password === "slow-down") return new Response("{}", { status: 429 });
    return password === "right-password"
      ? Response.json({ access_token: "at", refresh_token: "rt", user: { email: "abel@example.com" } })
      : new Response("{}", { status: 400 });
  }
  if (url.endsWith("/rest/v1/rpc/grant_datachat_pro")) return Response.json({ plan: "Pro" });
  if (url.endsWith("/auth/v1/user")) {
    const auth = init.headers?.Authorization;
    return auth === `Bearer ${validToken}`
      ? Response.json({ id: USER, email: "Abel@Example.com" })
      : new Response("{}", { status: 401 });
  }
  throw new Error(`unexpected fetch ${url}`);
}

beforeEach(() => {
  calls = [];
  validToken = "good-token";
  vi.stubGlobal("fetch", vi.fn(fakeSupabase));
});
afterEach(() => vi.unstubAllGlobals());

const call = (path, init = {}, e = env) => handleApi(new Request(`https://x${path}`, init), e);
const post = (path, body, headers = {}, e = env) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }, e);
const granted = () => calls.filter((c) => c.url.includes("grant_datachat_pro"));
const stripe = new Stripe("sk_test_dummy");
const signed = (payload) => ({ "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET }) });
const sessionEvent = (session, type = "checkout.session.completed") =>
  JSON.stringify({ id: "evt_1", object: "event", type, data: { object: { id: "cs_test_1", object: "checkout.session", payment_status: "paid", client_reference_id: USER, metadata: { userId: USER, plan: "Pro" }, ...session } } });

describe("username sign-in", () => {
  it("returns tokens only, never the email", async () => {
    const r = await post("/api/auth/login", { username: " Abel ", password: "right-password" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ access_token: "at", refresh_token: "rt" });
  });

  it("gives the same answer for an unknown user and a wrong password", async () => {
    const unknown = await post("/api/auth/login", { username: "nobody", password: "x" });
    const wrong = await post("/api/auth/login", { username: "abel", password: "wrong" });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.text()).toBe(await wrong.text());
  });

  it("passes Supabase rate limiting through as 429", async () => {
    const r = await post("/api/auth/login", { username: "abel", password: "slow-down" });
    expect(r.status).toBe(429);
  });

  it("rejects malformed bodies without calling Supabase", async () => {
    for (const body of ["not json", { username: "", password: "x" }, { username: "a".repeat(65), password: "x" }]) {
      expect((await post("/api/auth/login", body)).status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it("fails closed when the service role is not configured", async () => {
    const r = await post("/api/auth/login", { username: "abel", password: "right-password" }, {}, { ...env, SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(r.status).toBe(503);
  });
});

describe("checkout", () => {
  it("requires a valid Supabase session token", async () => {
    expect((await post("/api/stripe/create-checkout-session", { userId: USER, email: "a@b.c" })).status).toBe(401);
    expect((await post("/api/stripe/create-checkout-session", {}, { Authorization: "Bearer forged" })).status).toBe(401);
  });

  it("creates the session for the token's user, ignoring the body", async () => {
    const create = vi.fn(async () => ({ url: "https://checkout.stripe.test/s" }));
    const fakeStripe = { checkout: { sessions: { create } } };
    const r = await handleApi(
      new Request("https://x/api/stripe/create-checkout-session", { method: "POST", headers: { Authorization: "Bearer good-token" }, body: JSON.stringify({ userId: "someone-else" }) }),
      env,
      { stripe: fakeStripe },
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ url: "https://checkout.stripe.test/s" });
    const args = create.mock.calls[0][0];
    expect(args.client_reference_id).toBe(USER);
    expect(args.metadata.userId).toBe(USER);
    expect(args.customer_email).toBe("abel@example.com");
    expect(args.success_url).toBe("https://datachat.example/?checkout=success&session_id={CHECKOUT_SESSION_ID}");
  });
});

describe("Stripe webhook", () => {
  it("rejects a bad signature and grants nothing", async () => {
    const r = await post("/api/stripe/webhook", sessionEvent(), { "stripe-signature": "t=1,v1=bad" });
    expect(r.status).toBe(400);
    expect(granted()).toHaveLength(0);
  });

  it("grants Pro for a signed, paid session", async () => {
    const payload = sessionEvent();
    const r = await post("/api/stripe/webhook", payload, signed(payload));
    expect(r.status).toBe(200);
    expect(JSON.parse(granted()[0].init.body)).toEqual({ target_user: USER, grant_source: "stripe", grant_reference: "cs_test_1" });
    expect(granted()[0].init.headers.Authorization).toBe("Bearer service");
  });

  it("grants for delayed payment methods once they succeed", async () => {
    const payload = sessionEvent({}, "checkout.session.async_payment_succeeded");
    expect((await post("/api/stripe/webhook", payload, signed(payload))).status).toBe(200);
    expect(granted()).toHaveLength(1);
  });

  it("does not grant for unpaid sessions or sessions without a valid user", async () => {
    for (const session of [{ payment_status: "unpaid" }, { client_reference_id: null, metadata: {} }, { client_reference_id: "not-a-uuid", metadata: {} }]) {
      const payload = sessionEvent(session);
      expect((await post("/api/stripe/webhook", payload, signed(payload))).status).toBe(200);
    }
    expect(granted()).toHaveLength(0);
  });

  it("returns 500 when granting fails so Stripe retries", async () => {
    fetch.mockImplementation(async (url, init) => (String(url).includes("grant_datachat_pro") ? new Response("db down", { status: 500 }) : fakeSupabase(url, init)));
    const payload = sessionEvent();
    expect((await post("/api/stripe/webhook", payload, signed(payload))).status).toBe(500);
  });

  it("ignores unrelated events", async () => {
    const payload = JSON.stringify({ id: "evt_2", object: "event", type: "invoice.paid", data: { object: {} } });
    expect((await post("/api/stripe/webhook", payload, signed(payload))).status).toBe(200);
    expect(granted()).toHaveLength(0);
  });
});

describe("session status and misc", () => {
  it("rejects malformed session ids before calling Stripe", async () => {
    for (const id of ["", "../evil", "cs_test_1/../../x", "pi_123"])
      expect((await call(`/api/stripe/session-status?session_id=${encodeURIComponent(id)}`)).status).toBe(400);
  });

  it("answers CORS preflight for the app origins with Authorization allowed", async () => {
    const r = await call("/api/health", { method: "OPTIONS", headers: { Origin: "capacitor://localhost" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
    expect(r.headers.get("Access-Control-Allow-Headers")).toMatch(/Authorization/);
  });

  it("does not reflect unknown origins", async () => {
    const r = await call("/api/health", { headers: { Origin: "https://evil.example" } });
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://datachat.example");
  });

  it("reports configuration without leaking secrets", async () => {
    const body = await (await call("/api/health")).text();
    expect(JSON.parse(body)).toMatchObject({ ok: true, stripeConfigured: true, accountsConfigured: true });
    for (const secret of ["service", "sk_test_dummy", "whsec"]) expect(body).not.toContain(secret);
  });

  it("returns 404 JSON for unknown routes", async () => {
    expect((await call("/api/nope")).status).toBe(404);
  });
});
