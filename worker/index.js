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

async function persistPaidPlan(env, userId) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !userId) return false;
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        plan: "Pro",
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Subscription persistence failed (${response.status}).`);
  return true;
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
      paymentLink: env.STRIPE_PAYMENT_LINK || "",
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
      if (
        session.payment_status === "paid" &&
        session.client_reference_id
      ) {
        await persistPaidPlan(env, session.client_reference_id);
      }
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
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (url.pathname === "/downloads/DataChat-latest.apk" ||
        url.pathname === "/downloads/DataChat.apk" ||
        url.pathname === "/downloads/DataChat-1.1.1.apk" ||
        url.pathname === "/downloads/DataChat-1.2.0.apk" ||
        url.pathname === "/downloads/DataChat-1.3.5.apk")
    ) {
      const apk = await env.DOWNLOADS?.get("DataChat-latest.apk");
      if (!apk) return new Response("DataChat APK is not available.", { status: 404 });
      const headers = new Headers();
      apk.writeHttpMetadata(headers);
      headers.set("Content-Type", "application/vnd.android.package-archive");
      headers.set(
        "Content-Disposition",
        'attachment; filename="DataChat-latest.apk"',
      );
      headers.set("ETag", apk.httpEtag);
      headers.set("Cache-Control", "public, max-age=3600");
      return new Response(request.method === "HEAD" ? null : apk.body, {
        headers,
      });
    }
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname === "/downloads/DataChat-1.3.5.aab"
    ) {
      const bundle = await env.DOWNLOADS?.get("DataChat-1.3.5.aab");
      if (!bundle)
        return new Response("DataChat app bundle is not available.", {
          status: 404,
        });
      const headers = new Headers();
      bundle.writeHttpMetadata(headers);
      headers.set("Content-Type", "application/octet-stream");
      headers.set(
        "Content-Disposition",
        'attachment; filename="DataChat-1.3.5.aab"',
      );
      headers.set("ETag", bundle.httpEtag);
      headers.set("Cache-Control", "private, max-age=300");
      return new Response(request.method === "HEAD" ? null : bundle.body, {
        headers,
      });
    }
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname === "/downloads/DataChat-iOS-Xcode.zip"
    ) {
      const iosProject = await env.DOWNLOADS?.get("DataChat-iOS-Xcode.zip");
      if (!iosProject)
        return new Response("DataChat iOS project is not available.", {
          status: 404,
        });
      const headers = new Headers();
      iosProject.writeHttpMetadata(headers);
      headers.set("Content-Type", "application/zip");
      headers.set(
        "Content-Disposition",
        'attachment; filename="DataChat-iOS-Xcode.zip"',
      );
      headers.set("ETag", iosProject.httpEtag);
      headers.set("Cache-Control", "public, max-age=3600");
      return new Response(request.method === "HEAD" ? null : iosProject.body, {
        headers,
      });
    }
    return env.ASSETS.fetch(request);
  },
};
