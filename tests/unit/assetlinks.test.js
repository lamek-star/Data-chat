import { describe, expect, it } from "vitest";
import { ANDROID_PACKAGE, apkKeyHash, assetLinksResponse, parseFingerprints } from "../../shared/assetlinks.js";
import { webauthnConfig } from "../../shared/passkeys.js";

const FP = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";

describe("Android app link (assetlinks.json)", () => {
  it("is not served until a signing fingerprint is configured", () => {
    expect(assetLinksResponse({})).toBeNull();
    expect(assetLinksResponse({ ANDROID_SIGNING_SHA256: "not-a-fingerprint" })).toBeNull();
  });

  it("links the DataChat package to the domain for passkeys and links", async () => {
    const response = assetLinksResponse({ ANDROID_SIGNING_SHA256: FP.toLowerCase() });
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const [statement] = await response.json();
    expect(statement.relation).toEqual(["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"]);
    expect(statement.target).toEqual({ namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [FP] });
  });

  it("accepts several fingerprints and ignores malformed ones", () => {
    expect(parseFingerprints(`${FP}, bad, ${FP.replace(/^14/, "15")}`)).toHaveLength(2);
  });

  it("derives the app's passkey origin from the same fingerprint", () => {
    const hash = apkKeyHash(FP);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(webauthnConfig({ APP_URL: "https://datachat.harmongt.uk", ANDROID_SIGNING_SHA256: FP }).origins).toEqual([
      "https://datachat.harmongt.uk",
      `android:apk-key-hash:${hash}`,
    ]);
    expect(webauthnConfig({ APP_URL: "https://datachat.harmongt.uk" }).rpID).toBe("datachat.harmongt.uk");
  });
});
