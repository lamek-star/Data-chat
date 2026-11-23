// A software passkey authenticator for tests: real P-256 keys and real
// WebAuthn signatures, so the server's verification is exercised exactly as
// with a phone's fingerprint sensor. Uses only WebCrypto (works in Node and
// in browsers).

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) out.set(p, (offset += 0, offset)), (offset += p.length);
  return out;
};
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

// Minimal CBOR encoder: unsigned/negative integers, byte strings, text, maps.
function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Uint8Array.of((major << 5) | n);
    if (n < 256) return Uint8Array.of((major << 5) | 24, n);
    if (n < 65536) return Uint8Array.of((major << 5) | 25, n >> 8, n & 255);
    return Uint8Array.of((major << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  };
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  if (typeof value === "string") {
    const bytes = enc.encode(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (value instanceof Map) return concat(head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]));
  throw new Error("unsupported CBOR value");
}

// WebCrypto ECDSA gives r||s; WebAuthn wants an ASN.1 DER signature.
function derSignature(raw) {
  const int = (bytes) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let b = bytes.slice(i);
    if (b[0] & 0x80) b = concat(Uint8Array.of(0), b);
    return concat(Uint8Array.of(0x02, b.length), b);
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return concat(Uint8Array.of(0x30, r.length + s.length), r, s);
}

export async function createSoftAuthenticator({ origin, rpID }) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  let counter = 0;
  const rpIdHash = await sha256(enc.encode(rpID));
  const counterBytes = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

  return {
    id: b64url(credentialId),

    /** Answer to navigator.credentials.create(). Options: { userVerified, origin }. */
    async register(options, { userVerified = true, origin: o = origin } = {}) {
      const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, fromB64url(jwk.x)], [-3, fromB64url(jwk.y)]]));
      const flags = 0x01 | (userVerified ? 0x04 : 0) | 0x40; // UP, UV, AT
      const authData = concat(rpIdHash, Uint8Array.of(flags), counterBytes(counter), new Uint8Array(16), Uint8Array.of(0, credentialId.length), credentialId, cose);
      const clientDataJSON = enc.encode(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: o, crossOrigin: false }));
      const attestationObject = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ["internal"] },
      };
    },

    /** Answer to navigator.credentials.get(). Options: { userVerified, origin, tamper }. */
    async authenticate(options, { userVerified = true, origin: o = origin, tamper = false } = {}) {
      counter += 1;
      const flags = 0x01 | (userVerified ? 0x04 : 0);
      const authData = concat(rpIdHash, Uint8Array.of(flags), counterBytes(counter));
      const clientDataJSON = enc.encode(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: o, crossOrigin: false }));
      const signed = concat(authData, await sha256(clientDataJSON));
      const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signed));
      if (tamper) raw[5] ^= 1;
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
        response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(derSignature(raw)), userHandle: undefined },
      };
    },
  };
}
