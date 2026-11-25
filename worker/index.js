import { connect } from "cloudflare:sockets";
import { routeRequest } from "../shared/router.js";

export default {
  async fetch(request, env) {
    // connect() lets the API send sign-in emails through Gmail over SMTP.
    return routeRequest(request, { ...env, SMTP_CONNECT: connect });
  },
};
