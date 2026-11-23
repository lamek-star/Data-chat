// DataChat private API, shared by the Cloudflare Worker (worker/index.js) and
// the local Express server (server/index.js). Uses only fetch/Request/Response
// so it runs unchanged in both runtimes. Everything runs on Cloudflare:
// D1 for data (shared/auth.js, shared/data.js), Email Service for sign-in.
//
// Configuration (Worker variables / secrets, or .dev.vars locally):
//   DB                     D1 binding (migrations/)
//   EMAIL                  send_email binding (Cloudflare Email Service)
//   FILES                  optional R2 binding for profile photos
//   AUTH_SECRET            secret: HMAC key for sign-in codes
//   AUTH_EMAIL_FROM        sender for sign-in emails
//   STRIPE_SECRET_KEY, STRIPE_PRO_PRICE_ID, STRIPE_WEBHOOK_SECRET
//   APP_URL                public app URL for redirects
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
import {
  ApiError,
  adminCreateCode,
  adminListCodes,
  adminListMembers,
  adminSetMember,
  findProfiles,
  grantPro,
  listMessages,
  loadData,
  markRead,
  readAvatar,
  redeemCode,
  replaceData,
  saveProfilePhoto,
  sendMessage,
  updateProfile,
} from "./data.js";
import { requestLocation } from "./email.js";
import {
  createSeal,
  listPasskeys,
  listSeals,
  openSeal,
  openSealOptions,
  passkeyRegistrationOptions,
  removePasskey,
  verifyPasskeyRegistration,
} from "./passkeys.js";

const DEFAULT_APP_URL = "https://datachat.harmongt.uk";
const MAX_JSON_BYTES = 9_000_000;

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
    "Access-Control-Allow-Origin": origins.has(origin) ? origin : (env.APP_URL || DEFAULT_APP_URL),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function json(request, env, body, status = 200, extraHeaders = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(request, env), ...extraHeaders } });
}

const isJson = (request) => (request.headers.get("Content-Type") || "").includes("application/json");

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_JSON_BYTES) throw new ApiError(413, "Request too large.");
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new ApiError(413, "Request too large.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "Invalid JSON.");
  }
}

// Email-code sign-in (shared/auth.js).
async function authRoutes(request, env, url) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (url.pathname === "/api/auth/email/start" && request.method === "POST") {
    const { email } = await readJson(request);
    await startEmailLogin(env, { email, ip, location: requestLocation(request.cf) });
    return json(request, env, { sent: true });
  }
  if (url.pathname === "/api/auth/email/verify" && request.method === "POST") {
    const body = await readJson(request);
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
  return null;
}

// Member data (shared/data.js). Every route needs a signed-in, active member.
async function memberRoutes(request, env, url, user) {
  const { pathname } = url;
  const m = request.method;
  if (pathname === "/api/data" && m === "GET") return json(request, env, { records: await loadData(env, user) });
  if (pathname === "/api/data" && m === "PUT") return json(request, env, await replaceData(env, user, (await readJson(request)).records));
  if (pathname === "/api/profiles" && m === "GET")
    return json(request, env, { profiles: await findProfiles(env, { ids: url.searchParams.get("ids"), code: url.searchParams.get("code") }) });
  if (pathname === "/api/profile" && m === "PATCH") return json(request, env, { profile: await updateProfile(env, user, await readJson(request)) });
  if (pathname === "/api/profile/photo" && m === "PUT") return json(request, env, await saveProfilePhoto(env, user, request));
  if (pathname === "/api/messages" && m === "GET") return json(request, env, { messages: await listMessages(env, user, url.searchParams.get("since")) });
  if (pathname === "/api/messages" && m === "POST") return json(request, env, { message: await sendMessage(env, user, await readJson(request)) });
  if (pathname === "/api/messages/read" && m === "POST") return json(request, env, await markRead(env, user, (await readJson(request)).ids));
  if (pathname === "/api/pro/redeem" && m === "POST") return json(request, env, await redeemCode(env, user, (await readJson(request)).code));
  if (pathname === "/api/admin/members" && m === "GET") return json(request, env, { members: await adminListMembers(env, user) });
  if (pathname === "/api/admin/members" && m === "PATCH") return json(request, env, await adminSetMember(env, user, await readJson(request)));
  if (pathname === "/api/admin/codes" && m === "GET") return json(request, env, { codes: await adminListCodes(env, user) });
  if (pathname === "/api/admin/codes" && m === "POST") return json(request, env, { code: await adminCreateCode(env, user, (await readJson(request)).code) });
  // Passkeys (fingerprint / face unlock) and sealed transfers.
  if (pathname === "/api/passkeys" && m === "GET") return json(request, env, { passkeys: await listPasskeys(env, user) });
  if (pathname === "/api/passkeys/register/options" && m === "POST") return json(request, env, await passkeyRegistrationOptions(env, user));
  if (pathname === "/api/passkeys/register/verify" && m === "POST") return json(request, env, await verifyPasskeyRegistration(env, user, await readJson(request)));
  if (pathname === "/api/passkeys/remove" && m === "POST") return json(request, env, await removePasskey(env, user, (await readJson(request)).id));
  if (pathname === "/api/sealed" && m === "POST") return json(request, env, await createSeal(env, user, await readJson(request)));
  if (pathname === "/api/sealed" && m === "GET") return json(request, env, { seals: await listSeals(env, user, url.searchParams.get("box")) });
  if (pathname === "/api/sealed/open/options" && m === "POST") return json(request, env, await openSealOptions(env, user, await readJson(request)));
  if (pathname === "/api/sealed/open" && m === "POST") return json(request, env, await openSeal(env, user, await readJson(request)));
  return null;
}

// Grants Pro for a paid Checkout Session. Safe to call more than once.
async function grantProForSession(env, session) {
  if (session.payment_status !== "paid") return false;
  return grantPro(env, session.client_reference_id || session.metadata?.userId);
}

// deps.stripe lets tests supply a fake Stripe client.
export async function handleApi(request, env, deps = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });

  const stripe = env.STRIPE_SECRET_KEY ? deps.stripe || new Stripe(env.STRIPE_SECRET_KEY) : null;
  const checkoutConfigured = Boolean(stripe && env.STRIPE_PRO_PRICE_ID);

  try {
    if (url.pathname === "/api/health")
      return json(request, env, {
        ok: true,
        app: "DataChat",
        stripeConfigured: checkoutConfigured,
        accountsConfigured: Boolean(env.DB && env.AUTH_SECRET),
        emailConfigured: Boolean((env.GMAIL_USER && env.GMAIL_APP_PASSWORD) || (env.EMAIL && env.AUTH_EMAIL_FROM)),
      });

    // Writes must be JSON (blocks cross-site form posts) except the photo
    // upload (image/*, which forms cannot send) and the Stripe webhook.
    const writing = !["GET", "HEAD"].includes(request.method);
    const exempt = url.pathname === "/api/stripe/webhook" || url.pathname === "/api/profile/photo";
    if (writing && !exempt && !isJson(request)) return json(request, env, { error: "Send JSON." }, 415);

    if (url.pathname.startsWith("/api/auth/")) {
      const response = await authRoutes(request, env, url);
      if (response) return response;
    }

    if (url.pathname.startsWith("/api/avatars/") && request.method === "GET") {
      const avatar = await readAvatar(env, url.pathname.slice("/api/avatars/".length));
      return avatar || json(request, env, { error: "Not found." }, 404);
    }

    if (url.pathname === "/api/stripe/config" && request.method === "GET")
      return json(request, env, {
        configured: checkoutConfigured,
        planName: env.PRO_PLAN_NAME || "DataChat Pro",
        priceLabel: env.PRO_PLAN_PRICE_LABEL || "Set in Stripe",
      });

    if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
      if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return new Response("Stripe webhook is not configured.", { status: 503 });
      let event;
      try {
        event = await stripe.webhooks.constructEventAsync(await request.text(), request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
      } catch (error) {
        return new Response(`Webhook error: ${error.message}`, { status: 400 });
      }
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        if (!env.DB) return new Response("Database is not configured.", { status: 503 });
        // A database failure throws -> 500, so Stripe retries the event.
        await grantProForSession(env, event.data.object);
      }
      return Response.json({ received: true, type: event.type });
    }

    if (url.pathname === "/api/stripe/session-status" && request.method === "GET") {
      if (!checkoutConfigured) return json(request, env, { error: "Stripe is not configured." }, 503);
      const sessionId = url.searchParams.get("session_id") || "";
      if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return json(request, env, { error: "Invalid checkout session." }, 400);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // Granting here as well as in the webhook means Pro appears right after
      // the redirect even if the webhook is delayed. Both are idempotent.
      const granted = env.DB ? await grantProForSession(env, session) : false;
      return json(request, env, {
        status: session.status,
        paymentStatus: session.payment_status,
        userId: session.client_reference_id,
        plan: session.metadata?.plan || "Pro",
        granted,
      });
    }

    // Everything below needs a signed-in, active member.
    const user = await sessionUser(env, request);

    if (url.pathname === "/api/stripe/create-checkout-session" && request.method === "POST") {
      if (!checkoutConfigured) return json(request, env, { error: "Stripe checkout is not configured." }, 503);
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

    const known = /^\/api\/(data|profiles?|profile\/photo|messages(\/read)?|pro\/redeem|admin\/(members|codes)|passkeys(\/register\/(options|verify)|\/remove)?|sealed(\/open(\/options)?)?)$/.test(url.pathname);
    if (known) {
      if (!user) return json(request, env, { error: "Sign in to continue." }, 401);
      const response = await memberRoutes(request, env, url, user);
      if (response) return response;
      return json(request, env, { error: "Method not allowed." }, 405);
    }

    return json(request, env, { error: "API route not found." }, 404);
  } catch (error) {
    if (error instanceof AuthError || error instanceof ApiError)
      return json(request, env, { error: error.message, ...(error.reason ? { reason: error.reason } : {}) }, error.status);
    console.error("DataChat API error", url.pathname, error.message);
    return json(request, env, { error: "The server could not complete this request." }, 500);
  }
}
