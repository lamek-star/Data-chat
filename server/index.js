// Local development server for the private API. Production runs the same
// handlers in the Cloudflare Worker (worker/index.js).
import "dotenv/config";
import express from "express";
import { handleApi } from "../shared/api.js";

const app = express();
const port = Number(process.env.PAYMENTS_PORT || 4242);
const env = {
  ...process.env,
  APP_URL: process.env.APP_URL || "http://localhost:5173",
  SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
};

// Raw body for every route: the Stripe webhook needs the exact bytes to
// verify its signature, and the shared handler parses JSON itself.
app.use("/api", express.raw({ type: () => true, limit: "1mb" }), async (req, res) => {
  const hasBody = !["GET", "HEAD"].includes(req.method) && req.body?.length;
  const request = new Request(`http://localhost:${port}${req.originalUrl}`, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([name, value]) =>
      Array.isArray(value) ? value.map((v) => [name, v]) : [[name, String(value)]],
    ),
    body: hasBody ? req.body : undefined,
  });
  const response = await handleApi(request, env);
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.send(Buffer.from(await response.arrayBuffer()));
});

app.listen(port, () => console.info(`DataChat API listening on http://localhost:${port}`));
