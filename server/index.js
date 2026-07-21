import "dotenv/config";
import express from "express";
import Stripe from "stripe";
import cors from "cors";

const app = express();
const port = Number(process.env.PAYMENTS_PORT || 4242);
const appUrl = process.env.APP_URL || "http://localhost:5173";
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripePrice = process.env.STRIPE_PRO_PRICE_ID;
const checkoutMode = process.env.STRIPE_CHECKOUT_MODE === "payment" ? "payment" : "subscription";
const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
const configured = () => Boolean(stripe && stripePrice);

app.use(cors({
  origin: [appUrl, "http://localhost:5173", "capacitor://localhost", "http://localhost"],
  methods: ["GET", "POST"],
}));

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET)
    return res.status(503).send("Stripe webhook is not configured.");
  try {
    const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.info("Pro checkout completed", session.id, session.client_reference_id);
    }
    res.json({ received: true });
  } catch (error) {
    res.status(400).send(`Webhook error: ${error.message}`);
  }
});

app.use(express.json());

app.get("/api/stripe/config", (_req, res) => {
  res.json({ configured: configured(), planName: process.env.PRO_PLAN_NAME || "DataChat Pro", priceLabel: process.env.PRO_PLAN_PRICE_LABEL || "Set in Stripe" });
});

app.post("/api/stripe/create-checkout-session", async (req, res) => {
  if (!configured()) return res.status(503).json({ error: "Card checkout needs STRIPE_SECRET_KEY and STRIPE_PRO_PRICE_ID in your .env file." });
  const { userId, email } = req.body || {};
  if (!userId || !email) return res.status(400).json({ error: "A signed-in user is required." });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: checkoutMode,
      line_items: [{ price: stripePrice, quantity: 1 }],
      customer_email: String(email).trim().toLowerCase(),
      client_reference_id: String(userId),
      metadata: { userId: String(userId), plan: "Pro" },
      allow_promotion_codes: true,
      success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?checkout=cancelled`,
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe session creation failed", error.message);
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/stripe/session-status", async (req, res) => {
  if (!configured()) return res.status(503).json({ error: "Stripe is not configured." });
  const sessionId = String(req.query.session_id || "");
  if (!sessionId.startsWith("cs_")) return res.status(400).json({ error: "Invalid checkout session." });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    res.json({ status: session.status, paymentStatus: session.payment_status, userId: session.client_reference_id, email: session.customer_details?.email || session.customer_email, plan: session.metadata?.plan });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.listen(port, () => console.info(`DataChat payment server listening on http://localhost:${port}`));
