// DataChat private API, shared by the Cloudflare Worker (worker/index.js) and
// the local Express server (server/index.js). Uses only fetch/Request/Response
// so it runs unchanged in both runtimes.
//
// Required configuration (Worker secrets / .env):
//   SUPABASE_URL, SUPABASE_ANON_KEY          public project values
//   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY   secret: grants Pro, username login
//   STRIPE_SECRET_KEY, STRIPE_PRO_PRICE_ID   secret / price for checkout
//   STRIPE_WEBHOOK_SECRET                    secret: verifies Stripe webhooks
//   APP_URL                                  public app URL for redirects
import Stripe from "stripe";
import {
  AuthError,
  clearSessionCookie,
  endSession,
  publicUser,
  sessionCookie,
  sessionUser,
  startEmailLogin,
  verifyEmailLogin,
} from "./auth.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_APP_URL = "https://datachat.harmongt.uk";

function allowedOrigins(env) {
  const appUrl = (env.APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
  const extra = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([
    appUrl,
    appUrl.replace("://", "://www."),
    "capacitor://localhost",
    "https://localhost",
    "http://localhost",
    "http://localhost:5173",
    ...extra,
  ]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const origins = allowedOrigins(env);
  return {
    "Access-Control-Allow-Origin": origins.has(origin)
      ? origin
      : (env.APP_URL || DEFAULT_APP_URL),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(request, env, body, status = 200, extraHeaders = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(request, env), ...extraHeaders } });
}

// Email-code sign-in backed by D1 (shared/auth.js).
async function cloudflareAuth(request, env, url) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  try {
    if (request.method === "POST") {
      // JSON only: blocks cross-site form posts (CSRF) on top of SameSite cookies.
      if (!(request.headers.get("Content-Type") || "").includes("application/json"))
        return json(request, env, { error: "Send JSON." }, 415);
    }
    if (url.pathname === "/api/auth/email/start" && request.method === "POST") {
      const { email } = await request.json().catch(() => ({}));
      await startEmailLogin(env, { email, ip });
      return json(request, env, { sent: true });
    }
    if (url.pathname === "/api/auth/email/verify" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { token, user, expiresAt } = await verifyEmailLogin(env, { email: body.email, code: body.code, profile: body.profile, ip });
      // Native apps keep the token in secure storage; browsers only get the HttpOnly cookie.
      const payload = body.client === "native" ? { user, token, expiresAt } : { user, expiresAt };
      return json(request, env, payload, 200, { "Set-Cookie": sessionCookie(token) });
    }
    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const user = await sessionUser(env, request);
      return user ? json(request, env, { user: publicUser(user) }) : json(request, env, { error: "Not signed in." }, 401);
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      await endSession(env, request);
      return json(request, env, { signedOut: true }, 200, { "Set-Cookie": clearSessionCookie() });
    }
    return json(request, env, { error: "API route not found." }, 404);
  } catch (error) {
    if (error instanceof AuthError) return json(request, env, { error: error.message }, error.status);
    throw error;
  }
}

// Accept both names: Supabase's newer dashboards call it the "secret key"
// (sb_secret_...), older ones the "service_role key" (a JWT).
const serviceKey = (env) => env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "";

const supabaseConfigured = (env) =>
  Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && serviceKey(env));

// New sb_secret_ keys are not JWTs: send them only as apikey. Legacy
// service_role JWTs also go in the Authorization header.
function serviceHeaders(env) {
  const key = serviceKey(env);
  return key.startsWith("sb_")
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };
}

async function supabaseRpc(env, name, args) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(env),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${name} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

// Verifies the caller's Supabase access token and returns the user.
async function authenticatedUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

// Grants Pro for a paid Checkout Session. Safe to call more than once.
async function grantProForSession(env, session) {
  const userId = session.client_reference_id || session.metadata?.userId;
  if (session.payment_status !== "paid" || !UUID.test(String(userId || ""))) return false;
  await supabaseRpc(env, "grant_datachat_pro", {
    target_user: userId,
    grant_source: "stripe",
    grant_reference: session.id,
  });
  return true;
}

async function usernameLogin(request, env) {
  if (!supabaseConfigured(env))
    return json(request, env, { error: "Username sign-in is not configured on the server." }, 503);
  const { username, password } = await request.json().catch(() => ({}));
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized || !password || normalized.length > 64)
    return json(request, env, { error: "Username or password is incorrect." }, 401);

  const email = await supabaseRpc(env, "datachat_login_email", { requested_username: normalized });
  // Same answer for an unknown username and a wrong password, and the email
  // address is never returned to the caller.
  if (!email) return json(request, env, { error: "Username or password is incorrect." }, 401);

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: String(password) }),
  });
  if (response.status === 429)
    return json(request, env, { error: "Too many sign-in attempts. Wait a few minutes and try again." }, 429);
  if (!response.ok) return json(request, env, { error: "Username or password is incorrect." }, 401);
  const session = await response.json();
  return json(request, env, {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
}

// deps.stripe lets tests supply a fake Stripe client.
export async function handleApi(request, env, deps = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });

  const stripe = env.STRIPE_SECRET_KEY
    ? deps.stripe || new Stripe(env.STRIPE_SECRET_KEY)
    : null;
  const checkoutConfigured = Boolean(stripe && env.STRIPE_PRO_PRICE_ID);

  try {
    if (url.pathname === "/api/health")
      return json(request, env, {
        ok: true,
        app: "DataChat",
        stripeConfigured: checkoutConfigured,
        accountsConfigured: supabaseConfigured(env),
      });

    if (url.pathname === "/api/auth/login" && request.method === "POST")
      return await usernameLogin(request, env);

    if (url.pathname.startsWith("/api/auth/") && url.pathname !== "/api/auth/login")
      return await cloudflareAuth(request, env, url);

    if (url.pathname === "/api/stripe/config" && request.method === "GET")
      return json(request, env, {
        configured: checkoutConfigured,
        planName: env.PRO_PLAN_NAME || "DataChat Pro",
        priceLabel: env.PRO_PLAN_PRICE_LABEL || "Set in Stripe",
      });

    if (url.pathname === "/api/stripe/create-checkout-session" && request.method === "POST") {
      if (!checkoutConfigured)
        return json(request, env, { error: "Stripe checkout is not configured." }, 503);
      const user = await authenticatedUser(request, env);
      if (!user) return json(request, env, { error: "Sign in again before upgrading." }, 401);
      const appUrl = (env.APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
      const session = await stripe.checkout.sessions.create({
        mode: env.STRIPE_CHECKOUT_MODE === "payment" ? "payment" : "subscription",
        line_items: [{ price: env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
        customer_email: String(user.email || "").toLowerCase() || undefined,
        client_reference_id: user.id,
        metadata: { userId: user.id, plan: "Pro" },
        allow_promotion_codes: true,
        success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/?checkout=cancelled`,
      });
      return json(request, env, { url: session.url });
    }

    if (url.pathname === "/api/stripe/session-status" && request.method === "GET") {
      if (!checkoutConfigured)
        return json(request, env, { error: "Stripe is not configured." }, 503);
      const sessionId = url.searchParams.get("session_id") || "";
      if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId))
        return json(request, env, { error: "Invalid checkout session." }, 400);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // Granting here as well as in the webhook means Pro appears right after
      // the redirect even if the webhook is delayed. Both paths are idempotent.
      const granted = supabaseConfigured(env) ? await grantProForSession(env, session) : false;
      return json(request, env, {
        status: session.status,
        paymentStatus: session.payment_status,
        userId: session.client_reference_id,
        plan: session.metadata?.plan || "Pro",
        granted,
      });
    }

    if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
      if (!stripe || !env.STRIPE_WEBHOOK_SECRET)
        return new Response("Stripe webhook is not configured.", { status: 503 });
      let event;
      try {
        event = await stripe.webhooks.constructEventAsync(
          await request.text(),
          request.headers.get("stripe-signature"),
          env.STRIPE_WEBHOOK_SECRET,
        );
      } catch (error) {
        return new Response(`Webhook error: ${error.message}`, { status: 400 });
      }
      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        if (!supabaseConfigured(env))
          return new Response("Supabase service role is not configured.", { status: 503 });
        // A failure here returns 500 so Stripe retries the event.
        await grantProForSession(env, event.data.object);
      }
      return Response.json({ received: true, type: event.type });
    }

    return json(request, env, { error: "API route not found." }, 404);
  } catch (error) {
    console.error("DataChat API error", url.pathname, error.message);
    return json(request, env, { error: "The server could not complete this request." }, 500);
  }
}
