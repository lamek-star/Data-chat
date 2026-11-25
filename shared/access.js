// Optional second lock for the admin dashboard: Cloudflare Access (Zero Trust).
// When Access protects admin.datachat.harmongt.uk, Cloudflare signs every
// request it lets through with a JWT (Cf-Access-Jwt-Assertion). Checking that
// token here means a request that somehow bypasses Access (a misconfigured
// rule, a direct workers.dev hit) is still refused.
//
// Configuration (both required to turn the check on):
//   ACCESS_TEAM_DOMAIN  e.g. "https://yourteam.cloudflareaccess.com"
//   ACCESS_AUD          the Access application's "Application Audience (AUD) Tag"

const encoder = new TextEncoder();
const CERTS_TTL_MS = 60 * 60 * 1000;
let certCache = { url: "", at: 0, keys: [] };

const b64urlToBytes = (value) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};
const decodePart = (part) => JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));

export const accessConfigured = (env) => Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);

async function signingKeys(teamDomain, fetchImpl, now) {
  const url = `${teamDomain.replace(/\/$/, "")}/cdn-cgi/access/certs`;
  if (certCache.url === url && now - certCache.at < CERTS_TTL_MS && certCache.keys.length) return certCache.keys;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Access certs unavailable (${response.status})`);
  const { keys = [] } = await response.json();
  certCache = { url, at: now, keys };
  return keys;
}

/** Resets the cached signing keys (tests). */
export const resetAccessCache = () => (certCache = { url: "", at: 0, keys: [] });

/**
 * Returns the verified identity { email, sub } or null when the request
 * doesn't carry a valid Access token for this application.
 */
export async function verifyAccess(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const team = String(env.ACCESS_TEAM_DOMAIN).replace(/\/$/, "");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const seconds = Math.floor(now / 1000);
  if (payload.iss !== team || !audiences.includes(env.ACCESS_AUD)) return null;
  if (typeof payload.exp !== "number" || payload.exp <= seconds) return null;
  if (typeof payload.nbf === "number" && payload.nbf > seconds + 60) return null;

  let keys;
  try {
    keys = await signingKeys(team, fetchImpl, now);
  } catch {
    return null; // fail closed: no keys, no entry
  }
  const jwk = keys.find((key) => key.kid === header.kid) || null;
  if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    return valid ? { email: String(payload.email || "").toLowerCase(), sub: payload.sub } : null;
  } catch {
    return null;
  }
}
