/**
 * Turns a password into the key DataChat sends to the server, so the password
 * itself never leaves the device: PBKDF2-SHA256, 310,000 rounds, salted with
 * the (lower-cased) email address. The server stores only an HMAC of the key
 * with its own secret (shared/password.js). Changing these numbers changes
 * every key, so bump the version label if they ever change.
 */
export const PASSWORD_ROUNDS = 310000;
const encoder = new TextEncoder();

export async function derivePasswordKey(email, password, rounds = PASSWORD_ROUNDS) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(String(password).normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(`datachat-password-v1:${String(email).trim().toLowerCase()}`), iterations: rounds },
    base,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const COMMON = new Set(["password", "password1", "12345678", "123456789", "1234567890", "qwerty123", "11111111", "00000000", "iloveyou", "datachat", "abcd1234", "password123"]);

/** A sentence explaining what's wrong with the password, or "" if it's fine. */
export function passwordProblem(password, email = "") {
  const value = String(password || "");
  if (value.length < 8) return "Use at least 8 characters.";
  if (value.length > 128) return "Use at most 128 characters.";
  if (COMMON.has(value.toLowerCase())) return "That password is too common. Choose another.";
  if (/^(.)\1+$/.test(value)) return "Don't repeat one character. Choose another password.";
  const local = String(email).split("@")[0].toLowerCase();
  if (local.length >= 4 && value.toLowerCase().includes(local)) return "Don't include your email name in the password.";
  return "";
}
