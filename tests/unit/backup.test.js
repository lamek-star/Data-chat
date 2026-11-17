import { describe, expect, it } from "vitest";
import { bytesToBase64, base64ToBytes, decryptBackup, encryptBackup } from "../../src/lib/backup.js";

describe("encrypted backups", () => {
  const data = { records: [{ id: "TXN-1", receiver: "ሳራ", key: "042917" }], contacts: [] };

  it("round-trips with the right password", async () => {
    const file = await encryptBackup(data, "correct horse battery");
    expect(await decryptBackup(file, "correct horse battery")).toEqual(data);
  });

  it("does not contain the plaintext", async () => {
    const file = await encryptBackup(data, "pw-123456");
    expect(file).not.toContain("042917");
    expect(file).not.toContain("TXN-1");
    expect(JSON.parse(file)).toMatchObject({ format: "datachat-encrypted-backup", version: 2, iterations: 310000 });
  });

  it("uses a fresh salt and IV every time", async () => {
    const a = JSON.parse(await encryptBackup(data, "pw"));
    const b = JSON.parse(await encryptBackup(data, "pw"));
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("gives a clear error for a wrong password or a changed file", async () => {
    const file = await encryptBackup(data, "right");
    await expect(decryptBackup(file, "wrong")).rejects.toThrow(/Wrong backup password/);
    const packed = JSON.parse(file);
    const bytes = base64ToBytes(packed.data);
    bytes[0] ^= 1;
    const tampered = JSON.stringify({ ...packed, data: bytesToBase64(bytes) });
    await expect(decryptBackup(tampered, "right")).rejects.toThrow(/Wrong backup password/);
  });

  it("rejects files that are not DataChat backups", async () => {
    await expect(decryptBackup("not json", "x")).rejects.toThrow(/not a DataChat backup/);
    await expect(decryptBackup('{"format":"other"}', "x")).rejects.toThrow(/Unsupported/);
    await expect(decryptBackup(JSON.stringify({ format: "datachat-encrypted-backup", iterations: 1 }), "x")).rejects.toThrow(/Unsupported/);
  });

  it("refuses to encrypt without a password", async () => {
    await expect(encryptBackup(data, "")).rejects.toThrow(/password is required/);
  });

  it("handles large backups (the old encoder overflowed the call stack)", async () => {
    const big = { records: Array.from({ length: 4000 }, (_, i) => ({ id: `TXN-${i}`, remark: "x".repeat(200) })) };
    const file = await encryptBackup(big, "pw");
    expect(file.length).toBeGreaterThan(800_000);
    expect((await decryptBackup(file, "pw")).records).toHaveLength(4000);
  });

  it("still restores version 1 files (250,000 iterations, no iterations field)", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode("old-pw"), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data)));
    const v1 = JSON.stringify({ format: "datachat-encrypted-backup", version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(enc)) });
    expect(await decryptBackup(v1, "old-pw")).toEqual(data);
  });
});
