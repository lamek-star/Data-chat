// Passkeys (fingerprint / face unlock via WebAuthn) and sealed transfers.
//
// A sealed transfer holds a transfer's details on the server, locked to one
// receiver. The sender's QR code carries only "DCS1:<id>.<token>". To read
// the details the receiver must (1) be signed in as that receiver, (2) hold
// the QR token, and (3) pass a passkey check with user verification
// (biometric or device PIN) on a passkey they registered. The server
// verifies the passkey signature before releasing anything.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { ApiError } from "./data.js";
import { apkKeyHash, parseFingerprints } from "./assetlinks.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PASSKEYS = 10;
const MAX_DETAILS_BYTES = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEAL = /^DCS1:([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,64})$/;
const encoder = new TextEncoder();
const sha256 = async (text) => isoBase64URL.fromBuffer(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);

/** Relying party (domain) and accepted origins for WebAuthn. */
export function webauthnConfig(env) {
  const appUrl = new URL(env.APP_URL || "https://datachat.harmongt.uk");
  const origins = new Set([appUrl.origin]);
  for (const origin of String(env.WEBAUTHN_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean)) origins.add(origin);
  // Passkeys created natively by the Android app report the app's signing
  // key hash, derived from the same fingerprint used for assetlinks.json.
  if (env.ANDROID_APK_KEY_HASH) origins.add(`android:apk-key-hash:${env.ANDROID_APK_KEY_HASH}`);
  for (const fingerprint of parseFingerprints(env.ANDROID_SIGNING_SHA256)) origins.add(`android:apk-key-hash:${apkKeyHash(fingerprint)}`);
  return { rpID: env.WEBAUTHN_RP_ID || appUrl.hostname, rpName: "DataChat", origins: [...origins] };
}

async function saveChallenge(env, user, purpose, challenge, sealId = null, now = Date.now()) {
  await env.DB.prepare("DELETE FROM webauthn_challenges WHERE user_id = ? AND purpose = ?").bind(user.id, purpose).run();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO webauthn_challenges (id, user_id, purpose, challenge, seal_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, user.id, purpose, challenge, sealId, now + CHALLENGE_TTL_MS).run();
}

/** Takes the pending challenge (single use). */
async function takeChallenge(env, user, purpose, sealId = null, now = Date.now()) {
  const row = await env.DB.prepare(
    "SELECT id, challenge, seal_id, expires_at FROM webauthn_challenges WHERE user_id = ? AND purpose = ?",
  ).bind(user.id, purpose).first();
  if (!row) throw new ApiError(400, "Start again: the fingerprint request expired.");
  await env.DB.prepare("DELETE FROM webauthn_challenges WHERE id = ?").bind(row.id).run();
  if (row.expires_at <= now || (sealId && row.seal_id !== sealId)) throw new ApiError(400, "Start again: the fingerprint request expired.");
  return row.challenge;
}

const transportsOf = (row) => {
  try {
    return JSON.parse(row.transports || "[]");
  } catch {
    return [];
  }
};

// ------------------------------------------------------------- passkeys --

export async function listPasskeys(env, user) {
  const { results } = await env.DB.prepare(
    "SELECT credential_id, device_name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at",
  ).bind(user.id).all();
  return results.map((r) => ({
    id: r.credential_id,
    deviceName: r.device_name,
    createdAt: new Date(r.created_at).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  }));
}

export async function passkeyRegistrationOptions(env, user) {
  const { rpID, rpName } = webauthnConfig(env);
  const { results: existing } = await env.DB.prepare("SELECT credential_id, transports FROM passkeys WHERE user_id = ?").bind(user.id).all();
  if (existing.length >= MAX_PASSKEYS) throw new ApiError(400, `You can register up to ${MAX_PASSKEYS} devices. Remove one first.`);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: encoder.encode(user.id),
    userName: user.email,
    userDisplayName: user.display_name || user.email,
    attestationType: "none",
    excludeCredentials: existing.map((r) => ({ id: r.credential_id, transports: transportsOf(r) })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required", authenticatorAttachment: "platform" },
  });
  await saveChallenge(env, user, "register", options.challenge);
  return options;
}

export async function verifyPasskeyRegistration(env, user, { response, deviceName }) {
  const { rpID, origins } = webauthnConfig(env);
  const expectedChallenge = await takeChallenge(env, user, "register");
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    throw new ApiError(400, `This device could not be registered: ${error.message}`);
  }
  if (!verification.verified) throw new ApiError(400, "This device could not be registered.");
  const { credential } = verification.registrationInfo;
  try {
    await env.DB.prepare(
      "INSERT INTO passkeys (credential_id, user_id, public_key, counter, transports, device_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      credential.id,
      user.id,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports || []),
      clean(deviceName, 60) || "This device",
      Date.now(),
    ).run();
  } catch (error) {
    if (/UNIQUE|PRIMARY/i.test(error.message)) throw new ApiError(409, "This device is already registered.");
    throw error;
  }
  return { registered: true, id: credential.id };
}

export async function removePasskey(env, user, id) {
  const result = await env.DB.prepare("DELETE FROM passkeys WHERE credential_id = ? AND user_id = ?").bind(String(id || ""), user.id).run();
  if (!result.meta?.changes) throw new ApiError(404, "Device not found.");
  return { removed: true };
}

// ------------------------------------------------------ sealed transfers --

export function parseSeal(value) {
  const match = SEAL.exec(String(value ?? "").trim());
  if (!match) throw new ApiError(400, "This is not a DataChat sealed transfer code.");
  return { id: match[1].toLowerCase(), token: match[2] };
}

export async function createSeal(env, user, { recipientId, details }) {
  if (!UUID.test(String(recipientId || ""))) throw new ApiError(400, "Choose a DataChat member as receiver.");
  if (recipientId === user.id) throw new ApiError(400, "You cannot seal a transfer to yourself.");
  const json = JSON.stringify(details ?? {});
  if (!details || typeof details !== "object" || Array.isArray(details)) throw new ApiError(400, "Missing transfer details.");
  if (json.length > MAX_DETAILS_BYTES) throw new ApiError(413, "These transfer details are too large.");
  const recipient = await env.DB.prepare("SELECT id, display_name FROM users WHERE id = ?").bind(recipientId).first();
  if (!recipient) throw new ApiError(404, "Unknown receiver.");
  const id = crypto.randomUUID();
  const token = isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.prepare(
    "INSERT INTO sealed_transfers (id, token_hash, sender_id, recipient_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, await sha256(token), user.id, recipientId, json, Date.now()).run();
  return { id, code: `DCS1:${id}.${token}`, recipientName: recipient.display_name };
}

export async function listSeals(env, user, box) {
  const column = box === "sent" ? "s.sender_id" : "s.recipient_id";
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.created_at, s.opened_at, snd.display_name AS sender_name, rcp.display_name AS recipient_name
     FROM sealed_transfers s JOIN users snd ON snd.id = s.sender_id JOIN users rcp ON rcp.id = s.recipient_id
     WHERE ${column} = ? ORDER BY s.created_at DESC LIMIT 200`,
  ).bind(user.id).all();
  return results.map((r) => ({
    id: r.id,
    senderName: r.sender_name,
    recipientName: r.recipient_name,
    createdAt: new Date(r.created_at).toISOString(),
    openedAt: r.opened_at ? new Date(r.opened_at).toISOString() : null,
  }));
}

/** Loads a seal for the signed-in receiver, checking the QR token. */
async function sealForRecipient(env, user, code) {
  const { id, token } = parseSeal(code);
  const seal = await env.DB.prepare("SELECT * FROM sealed_transfers WHERE id = ?").bind(id).first();
  // Same answer for "no such seal" and "wrong token", so codes cannot be probed.
  if (!seal || seal.token_hash !== (await sha256(token))) throw new ApiError(404, "This sealed transfer was not found.");
  if (seal.recipient_id !== user.id) throw new ApiError(403, "This transfer is locked to its receiver. Only they can open it.");
  return seal;
}

export async function openSealOptions(env, user, { code }) {
  const seal = await sealForRecipient(env, user, code);
  const { results: keys } = await env.DB.prepare("SELECT credential_id, transports FROM passkeys WHERE user_id = ?").bind(user.id).all();
  if (!keys.length)
    throw Object.assign(new ApiError(409, "Set up fingerprint or face unlock in Settings first, then scan again."), { reason: "NO_PASSKEY" });
  const { rpID } = webauthnConfig(env);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: keys.map((k) => ({ id: k.credential_id, transports: transportsOf(k) })),
    userVerification: "required",
  });
  await saveChallenge(env, user, "open-seal", options.challenge, seal.id);
  return options;
}

export async function openSeal(env, user, { code, response }) {
  const seal = await sealForRecipient(env, user, code);
  const expectedChallenge = await takeChallenge(env, user, "open-seal", seal.id);
  const key = await env.DB.prepare("SELECT * FROM passkeys WHERE credential_id = ? AND user_id = ?").bind(String(response?.id || ""), user.id).first();
  if (!key) throw new ApiError(403, "Use a fingerprint or face unlock registered on your account.");
  const { rpID, origins } = webauthnConfig(env);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: { id: key.credential_id, publicKey: isoBase64URL.toBuffer(key.public_key), counter: key.counter, transports: transportsOf(key) },
    });
  } catch (error) {
    throw new ApiError(403, `Fingerprint check failed: ${error.message}`);
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified) throw new ApiError(403, "Fingerprint check failed.");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?").bind(verification.authenticationInfo.newCounter, now, key.credential_id),
    env.DB.prepare("UPDATE sealed_transfers SET opened_at = COALESCE(opened_at, ?) WHERE id = ?").bind(now, seal.id),
  ]);
  const sender = await env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(seal.sender_id).first();
  return { id: seal.id, senderName: sender?.display_name, createdAt: new Date(seal.created_at).toISOString(), details: JSON.parse(seal.details) };
}
