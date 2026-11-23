import { connect } from "cloudflare:sockets";
import { handleApi } from "../shared/api.js";
import { assetLinksResponse } from "../shared/assetlinks.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // connect() lets the API send sign-in emails through Gmail over SMTP.
    if (url.pathname.startsWith("/api/")) return handleApi(request, { ...env, SMTP_CONNECT: connect });
    // Links the Android app to this domain so it can use passkeys here.
    if (url.pathname === "/.well-known/assetlinks.json")
      return assetLinksResponse(env) || new Response("Not configured", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
