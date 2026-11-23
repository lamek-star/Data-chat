// Fingerprint/face-locked ("sealed") transfers, end to end through the API
// with real passkey cryptography from a software authenticator.
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeEnv, signIn } from "./helpers.js";
import { createSoftAuthenticator } from "./soft-authenticator.js";

const ORIGIN = "https://datachat.test";
const RP_ID = "datachat.test";
let env, sender, receiver, stranger;
beforeEach(async () => {
  env = makeEnv();
  sender = await signIn(env, "sender@example.test", { name: "Abel Sender" });
  receiver = await signIn(env, "receiver@example.test", { name: "Sara Receiver" });
  stranger = await signIn(env, "stranger@example.test", { name: "Stranger" });
});
const as = (who, path, opts = {}) => call(env, path, { ...opts, token: who.token });
const json = async (r) => r.json();

async function registerDevice(who, device, options = {}) {
  const regOptions = await json(await as(who, "/api/passkeys/register/options", { method: "POST", body: {} }));
  const response = await device.register(regOptions, options);
  return as(who, "/api/passkeys/register/verify", { method: "POST", body: { response, deviceName: "Test phone" } });
}
async function sealTransfer(details = { amount: 250, currency: "USD", receiver: "Sara Receiver", claimCode: "DC1-TXN1-SARARECEIV-042917" }) {
  return json(await as(sender, "/api/sealed", { method: "POST", body: { recipientId: receiver.user.id, details } }));
}
async function unlock(who, code, device, options = {}) {
  const r = await as(who, "/api/sealed/open/options", { method: "POST", body: { code } });
  if (r.status !== 200) return r;
  const response = await device.authenticate(await r.json(), options);
  return as(who, "/api/sealed/open", { method: "POST", body: { code, response } });
}

describe("setting up fingerprint / face unlock", () => {
  it("registers a device with user verification and lists it", async () => {
    const phone = await createSoftAuthenticator({ origin: ORIGIN, rpID: RP_ID });
    const options = await json(await as(receiver, "/api/passkeys/register/options", { method: "POST", body: {} }));
    expect(options.rp).toEqual({ name: "DataChat", id: RP_ID });
    expect(options.authenticatorSelection).toMatchObject({ userVerification: "required", authenticatorAttachment: "platform" });
    const response = await phone.register(options);
    expect((await as(receiver, "/api/passkeys/register/verify", { method: "POST", body: { response, deviceName: "Sara's phone" } })).status).toBe(200);
    const { passkeys } = await json(await as(receiver, "/api/passkeys"));
    expect(passkeys).toEqual([expect.objectContaining({ id: phone.id, deviceName: "Sara's phone" })]);
  });

  it("refuses a device that skipped the fingerprint check, the wrong site, or a replayed request", async () => {
    const phone = await createSoftAuthenticator({ origin: ORIGIN, rpID: RP_ID });
    expect((await registerDevice(receiver, phone, { userVerified: false })).status).toBe(400);
    expect((await registerDevice(receiver, phone, { origin: "https://evil.example" })).status).toBe(400);
    const options = await json(await as(receiver, "/api/passkeys/register/options", { method: "POST", body: {} }));
    const response = await phone.register(options);
    expect((await as(receiver, "/api/passkeys/register/verify", { method: "POST", body: { response } })).status).toBe(200);
    expect((await as(receiver, "/api/passkeys/register/verify", { method: "POST", body: { response } })).status).toBe(400);
  });

  it("lets a member remove only their own devices", async () => {
    const phone = await createSoftAuthenticator({ origin: ORIGIN, rpID: RP_ID });
    await registerDevice(receiver, phone);
    expect((await as(stranger, "/api/passkeys/remove", { method: "POST", body: { id: phone.id } })).status).toBe(404);
    expect((await as(receiver, "/api/passkeys/remove", { method: "POST", body: { id: phone.id } })).status).toBe(200);
    expect((await json(await as(receiver, "/api/passkeys"))).passkeys).toEqual([]);
  });
});

describe("sealed transfers", () => {
  it("give the sender a QR code that contains no transfer details", async () => {
    const seal = await sealTransfer();
    expect(seal.code).toMatch(/^DCS1:[0-9a-f-]{36}\.[A-Za-z0-9_-]{32}$/);
    expect(seal.code).not.toMatch(/250|Sara|DC1-/);
    const sent = (await json(await as(sender, "/api/sealed?box=sent"))).seals;
    expect(sent).toEqual([expect.objectContaining({ recipientName: "Sara Receiver", openedAt: null })]);
    expect(JSON.stringify(sent)).not.toMatch(/claimCode|250/);
    const received = (await json(await as(receiver, "/api/sealed?box=received"))).seals;
    expect(received).toEqual([expect.objectContaining({ senderName: "Abel Sender" })]);
  });

  it("open for the receiver only after a verified fingerprint, and record when", async () => {
    const phone = await createSoftAuthenticator({ origin: ORIGIN, rpID: RP_ID });
    await registerDevice(receiver, phone);
    const { code } = await sealTransfer();
    const r = await unlock(receiver, code, phone);
    expect(r.status).toBe(200);
    const opened = await r.json();
    expect(opened).toMatchObject({ senderName: "Abel Sender", details: { amount: 250, claimCode: "DC1-TXN1-SARARECEIV-042917" } });
    const [sent] = (await json(await as(sender, "/api/sealed?box=sent"))).seals;
    expect(sent.openedAt).not.toBeNull();
  });

  it("stay locked for anyone else who scans the code, including the sender", async () => {
    const strangerPhone = await createSoftAuthenticator({ origin: ORIGIN, rpID: RP_ID });
    await registerDevice(stranger, strangerPhone);
    const { code } = await sealTransfer();
    const asStranger = await unlock(stranger, code, strangerPhone);
    expect(asStranger.status).toBe(403);
    expect((await asStranger.json()).error).toMatch(/locked to its receiver/);
    expect((await as(sender, "/api/sealed/open/options", { method: "POST", body: { code } })).status).toBe(403);
    expect((await call(env, "/api/sealed/open/options", { method: "POST", body: { code } })).status).toBe(401);
  });

  it("ask the receiver to set up fingerprint unlock first", async () => {
    const { code } = await sealTransfer();
    const r = await as(receiver, "/api/sealed/open/options", { method: "POST", body: { code } });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ reason: "NO_PASSKEY" });
  });

  it("cannot be guessed: a wrong token looks the same as no transfer", async () => {
    const { code } = await sealTransfer();
    const forged = code.replace(/\.[A-Za-z0-9_-]+$/, `.${"A".repeat(32)}`);
    expect((await as(receiver, "/api/sealed/open/options", { method: "POST", body: { code: forged } })).status).toBe(404);
    expect((await as(receiver, "/api/sealed/open/options", { method: "POST", body: { code: "DCS1:not-a-seal" } })).status).toBe(400);
  });

  it("reject a skipped fingerprint check, a forged signature, an unregistered key, the wrong site and replays", async () => {
    const phone = await createSoftAuthenticator({ origin: ORIGIN, rpID: RP_ID });
    await registerDevice(receiver, phone);
    const { code } = await sealTransfer();
    expect((await unlock(receiver, code, phone, { userVerified: false })).status).toBe(403);
    expect((await unlock(receiver, code, phone, { tamper: true })).status).toBe(403);
    expect((await unlock(receiver, code, phone, { origin: "https://evil.example" })).status).toBe(403);
    const otherPhone = await createSoftAuthenticator({ origin: ORIGIN, rpID: RP_ID });
    expect((await unlock(receiver, code, otherPhone)).status).toBe(403);
    // A successful unlock cannot be replayed: the challenge is single use.
    const options = await json(await as(receiver, "/api/sealed/open/options", { method: "POST", body: { code } }));
    const response = await phone.authenticate(options);
    expect((await as(receiver, "/api/sealed/open", { method: "POST", body: { code, response } })).status).toBe(200);
    expect((await as(receiver, "/api/sealed/open", { method: "POST", body: { code, response } })).status).toBe(400);
  });

  it("do not accept a challenge issued for a different transfer", async () => {
    const phone = await createSoftAuthenticator({ origin: ORIGIN, rpID: RP_ID });
    await registerDevice(receiver, phone);
    const first = await sealTransfer({ note: "first" });
    const second = await sealTransfer({ note: "second" });
    const options = await json(await as(receiver, "/api/sealed/open/options", { method: "POST", body: { code: first.code } }));
    const response = await phone.authenticate(options);
    expect((await as(receiver, "/api/sealed/open", { method: "POST", body: { code: second.code, response } })).status).toBe(400);
  });

  it("validate the receiver and the size of the details", async () => {
    expect((await as(sender, "/api/sealed", { method: "POST", body: { recipientId: sender.user.id, details: {} } })).status).toBe(400);
    expect((await as(sender, "/api/sealed", { method: "POST", body: { recipientId: crypto.randomUUID(), details: {} } })).status).toBe(404);
    expect((await as(sender, "/api/sealed", { method: "POST", body: { recipientId: receiver.user.id, details: { big: "x".repeat(25_000) } } })).status).toBe(413);
  });
});

describe("passkeys created inside the Android app", () => {
  it("are accepted when the app's signing-key hash is configured", async () => {
    env.ANDROID_APK_KEY_HASH = "abc123-test_hash";
    const appOrigin = "android:apk-key-hash:abc123-test_hash";
    const phone = await createSoftAuthenticator({ origin: appOrigin, rpID: RP_ID });
    expect((await registerDevice(receiver, phone)).status).toBe(200);
    const { code } = await sealTransfer();
    expect((await unlock(receiver, code, phone)).status).toBe(200);
  });
});
