// Digital Asset Links: tells Android that the DataChat app (signed with our
// release key) belongs to this domain. Android requires this before an app
// may use passkeys for the domain. Served at /.well-known/assetlinks.json.
//
// ANDROID_SIGNING_SHA256 = the release signing certificate's SHA-256
// fingerprint ("AB:CD:..."; public, not a secret). Several may be given,
// separated by commas (for example the Play upload key and app signing key).

export const ANDROID_PACKAGE = "com.lamekstar.datachat";
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function parseFingerprints(value) {
  return String(value || "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => FINGERPRINT.test(f));
}

/** Returns the assetlinks.json Response, or null when no key is configured. */
export function assetLinksResponse(env) {
  const fingerprints = parseFingerprints(env.ANDROID_SIGNING_SHA256);
  if (!fingerprints.length) return null;
  const body = [
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ];
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}

/**
 * The origin Android reports for passkeys made natively by the app:
 * "android:apk-key-hash:" + base64url(SHA-256 certificate fingerprint bytes).
 */
export function apkKeyHash(fingerprint) {
  const hex = String(fingerprint || "").replace(/:/g, "");
  if (!/^[0-9A-Fa-f]{64}$/.test(hex)) return "";
  const bytes = hex.match(/../g).map((h) => parseInt(h, 16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
