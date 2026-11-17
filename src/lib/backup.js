// Password-encrypted .dcbackup files: AES-256-GCM with a PBKDF2-SHA256 key.
// Format (JSON): { format, version, iterations, salt, iv, data } in base64.
// Version 1 files (no "iterations" field) used 250,000 iterations and still
// restore.

export const BACKUP_FORMAT = "datachat-encrypted-backup";
const ITERATIONS = 310_000; // OWASP 2023 recommendation for PBKDF2-SHA256
const LEGACY_ITERATIONS = 250_000;

// String.fromCharCode(...bytes) overflows the call stack for large arrays
// (roughly >100 KB), so convert in chunks.
export function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const base64ToBytes = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations, usage) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export async function encryptBackup(data, password) {
  if (!password) throw new Error("A backup password is required.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS, "encrypt");
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: 2,
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  });
}

export async function decryptBackup(text, password) {
  let packed;
  try {
    packed = JSON.parse(text);
  } catch {
    throw new Error("This is not a DataChat backup file.");
  }
  if (packed?.format !== BACKUP_FORMAT) throw new Error("Unsupported backup format.");
  const iterations = Number(packed.iterations) || LEGACY_ITERATIONS;
  if (iterations < 100_000 || iterations > 5_000_000) throw new Error("Unsupported backup format.");
  try {
    const key = await deriveKey(password, base64ToBytes(packed.salt), iterations, "decrypt");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(packed.iv) },
      key,
      base64ToBytes(packed.data),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    // AES-GCM cannot tell a wrong password from a modified file.
    throw new Error("Wrong backup password, or the file has been changed.");
  }
}
