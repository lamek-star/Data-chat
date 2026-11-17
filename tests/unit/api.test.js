import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { call, makeEnv, signIn } from "./helpers.js";

let env;
beforeEach(() => {
  env = makeEnv({ STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_PRO_PRICE_ID: "price_dummy", STRIPE_WEBHOOK_SECRET: "whsec_test_secret" });
});

const stripe = new Stripe("sk_test_dummy");
const signed = (payload) => ({ "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET }) });
const sessionEvent = (userId, session = {}, type = "checkout.session.completed") =>
  JSON.stringify({ id: "evt_1", object: "event", type, data: { object: { id: "cs_test_1", object: "checkout.session", payment_status: "paid", client_reference_id: userId, metadata: { userId, plan: "Pro" }, ...session } } });
const planOf = (email) => env.DB.raw.prepare("SELECT plan FROM users WHERE email = ?").get(email).plan;
const webhook = (payload, headers = signed(payload)) => call(env, "/api/stripe/webhook", { method: "POST", body: payload, headers: { "Content-Type": "application/json", ...headers } });

describe("checkout", () => {
  it("requires a signed-in member", async () => {
    expect((await call(env, "/api/stripe/create-checkout-session", { method: "POST", body: {} })).status).toBe(401);
    expect((await call(env, "/api/stripe/create-checkout-session", { method: "POST", body: {}, token: "forged-token-forged-token-forged" })).status).toBe(401);
  });

  it("creates the session for the signed-in member, ignoring the body", async () => {
    const { token, user } = await signIn(env, "Abel@Example.test");
    const create = vi.fn(async () => ({ url: "https://checkout.stripe.test/s" }));
    const r = await call(env, "/api/stripe/create-checkout-session", { method: "POST", body: { userId: "someone-else" }, token, deps: { stripe: { checkout: { sessions: { create } } } } });
    expect(r.status).toBe(200);
    const args = create.mock.calls[0][0];
    expect(args.client_reference_id).toBe(user.id);
    expect(args.metadata.userId).toBe(user.id);
    expect(args.customer_email).toBe("abel@example.test");
    expect(args.success_url).toBe("https://datachat.test/?checkout=success&session_id={CHECKOUT_SESSION_ID}");
  });
});

describe("Stripe webhook", () => {
  it("rejects a bad signature and grants nothing", async () => {
    const { user } = await signIn(env, "abel@example.test");
    expect((await webhook(sessionEvent(user.id), { "stripe-signature": "t=1,v1=bad" })).status).toBe(400);
    expect(planOf("abel@example.test")).toBe("Free");
  });

  it("grants Pro in D1 for a signed, paid session (and for delayed payments)", async () => {
    const { user } = await signIn(env, "abel@example.test");
    expect((await webhook(sessionEvent(user.id))).status).toBe(200);
    expect(planOf("abel@example.test")).toBe("Pro");
    const { user: ben } = await signIn(env, "ben@example.test");
    expect((await webhook(sessionEvent(ben.id, {}, "checkout.session.async_payment_succeeded"))).status).toBe(200);
    expect(planOf("ben@example.test")).toBe("Pro");
  });

  it("does not grant for unpaid sessions or sessions without a valid member", async () => {
    const { user } = await signIn(env, "abel@example.test");
    for (const payload of [sessionEvent(user.id, { payment_status: "unpaid" }), sessionEvent(null, { metadata: {} }), sessionEvent("not-a-uuid", { metadata: {} })])
      expect((await webhook(payload)).status).toBe(200);
    expect(planOf("abel@example.test")).toBe("Free");
  });

  it("returns 500 when the database fails, so Stripe retries", async () => {
    const { user } = await signIn(env, "abel@example.test");
    const payload = sessionEvent(user.id);
    env.DB = { prepare: () => { throw new Error("db down"); } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await webhook(payload)).status).toBe(500);
  });

  it("ignores unrelated events", async () => {
    const payload = JSON.stringify({ id: "evt_2", object: "event", type: "invoice.paid", data: { object: {} } });
    expect((await webhook(payload)).status).toBe(200);
  });
});

describe("misc", () => {
  it("rejects malformed session ids before calling Stripe", async () => {
    for (const id of ["", "../evil", "cs_test_1/../../x", "pi_123"])
      expect((await call(env, `/api/stripe/session-status?session_id=${encodeURIComponent(id)}`)).status).toBe(400);
  });

  it("answers CORS preflight for app origins, including PUT/PATCH and credentials", async () => {
    const r = await call(env, "/api/data", { method: "OPTIONS", headers: { Origin: "capacitor://localhost" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
    expect(r.headers.get("Access-Control-Allow-Methods")).toMatch(/PUT/);
    expect(r.headers.get("Access-Control-Allow-Headers")).toMatch(/Authorization/);
  });

  it("does not reflect unknown origins", async () => {
    const r = await call(env, "/api/health", { headers: { Origin: "https://evil.example" } });
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("https://datachat.test");
  });

  it("reports configuration without leaking secrets", async () => {
    const body = await (await call(env, "/api/health")).text();
    expect(JSON.parse(body)).toMatchObject({ ok: true, stripeConfigured: true, accountsConfigured: true, emailConfigured: true });
    for (const secret of ["sk_test_dummy", "whsec", "test-secret"]) expect(body).not.toContain(secret);
  });

  it("refuses non-JSON writes (cross-site form posts)", async () => {
    const { token } = await signIn(env, "abel@example.test");
    const r = await call(env, "/api/data", { method: "PUT", body: "records=[]", token, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    expect(r.status).toBe(415);
  });

  it("returns 404 for unknown routes and 405 for wrong methods", async () => {
    const { token } = await signIn(env, "abel@example.test");
    expect((await call(env, "/api/nope")).status).toBe(404);
    expect((await call(env, "/api/data", { method: "POST", body: {}, token })).status).toBe(405);
  });
});
