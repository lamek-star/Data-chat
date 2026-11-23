import { connect } from "cloudflare:sockets";
import { handleApi } from "../shared/api.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // connect() lets the API send sign-in emails through Gmail over SMTP.
    if (url.pathname.startsWith("/api/")) return handleApi(request, { ...env, SMTP_CONNECT: connect });
    return env.ASSETS.fetch(request);
  },
};
