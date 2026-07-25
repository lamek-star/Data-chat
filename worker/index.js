import Stripe from "stripe";

const allowedOrigins = new Set([
  "https://datachat.harmongt.uk",
  "https://www.datachat.harmongt.uk",
  "capacitor://localhost",
  "http://localhost",
  "http://localhost:5173",
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "https://datachat.harmongt.uk",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(request, body, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

function stripeClient(env) {
  return env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
}

async function handleApi(request, env, url) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(request) });

  const stripe = stripeClient(env);
  const configured = Boolean(stripe && env.STRIPE_PRO_PRICE_ID);

  if (url.pathname === "/api/health")
    return json(request, {
      ok: true,
      app: "DataChat",
      stripeConfigured: configured,
    });

  if (url.pathname === "/api/stripe/config" && request.method === "GET")
    return json(request, {
      configured,
      planName: env.PRO_PLAN_NAME || "DataChat Pro",
      priceLabel: env.PRO_PLAN_PRICE_LABEL || "Set in Stripe",
    });

  if (
    url.pathname === "/api/stripe/create-checkout-session" &&
    request.method === "POST"
  ) {
    if (!configured)
      return json(request, { error: "Stripe checkout is not configured." }, 503);
    const { userId, email } = await request.json();
    if (!userId || !email)
      return json(request, { error: "A signed-in user is required." }, 400);
    try {
      const appUrl = env.APP_URL || "https://datachat.harmongt.uk";
      const session = await stripe.checkout.sessions.create({
        mode: env.STRIPE_CHECKOUT_MODE === "payment" ? "payment" : "subscription",
        line_items: [{ price: env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
        customer_email: String(email).trim().toLowerCase(),
        client_reference_id: String(userId),
        metadata: { userId: String(userId), plan: "Pro" },
        allow_promotion_codes: true,
        success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/?checkout=cancelled`,
      });
      return json(request, { url: session.url });
    } catch (error) {
      return json(request, { error: error.message }, 400);
    }
  }

  if (
    url.pathname === "/api/stripe/session-status" &&
    request.method === "GET"
  ) {
    if (!configured)
      return json(request, { error: "Stripe is not configured." }, 503);
    const sessionId = url.searchParams.get("session_id") || "";
    if (!sessionId.startsWith("cs_"))
      return json(request, { error: "Invalid checkout session." }, 400);
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return json(request, {
        status: session.status,
        paymentStatus: session.payment_status,
        userId: session.client_reference_id,
        email:
          session.customer_details?.email || session.customer_email || null,
        plan: session.metadata?.plan,
      });
    } catch (error) {
      return json(request, { error: error.message }, 400);
    }
  }

  if (
    url.pathname === "/api/stripe/webhook" &&
    request.method === "POST"
  ) {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET)
      return new Response("Stripe webhook is not configured.", { status: 503 });
    try {
      const event = await stripe.webhooks.constructEventAsync(
        await request.text(),
        request.headers.get("stripe-signature"),
        env.STRIPE_WEBHOOK_SECRET,
      );
      return json(request, { received: true, type: event.type });
    } catch (error) {
      return new Response(`Webhook error: ${error.message}`, { status: 400 });
    }
  }

  return json(request, { error: "API route not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/"))
      return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
