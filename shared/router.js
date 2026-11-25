// Picks what answers a request, by host:
//  - the admin host (admin.datachat.harmongt.uk) -> the admin dashboard only
//  - every other host (the member app)           -> the app and member API;
//    the old /admin page redirects to the admin host, and /api/admin/* is
//    not served here at all.
import { handleApi } from "./api.js";
import { assetLinksResponse } from "./assetlinks.js";
import { handleAdminHost, isAdminHost, primaryAdminHost } from "./adminHost.js";

export async function routeRequest(request, env) {
  const url = new URL(request.url);
  if (isAdminHost(env, url.hostname)) return handleAdminHost(request, env);

  if (url.pathname === "/admin" || url.pathname === "/admin.html" || url.pathname.startsWith("/admin/"))
    return Response.redirect(`https://${primaryAdminHost(env)}/`, 301);
  if (url.pathname.startsWith("/api/")) return handleApi(request, env);
  // Links the Android app to this domain so it can use passkeys here.
  if (url.pathname === "/.well-known/assetlinks.json")
    return assetLinksResponse(env) || new Response("Not configured", { status: 404 });
  return env.ASSETS.fetch(request);
}
