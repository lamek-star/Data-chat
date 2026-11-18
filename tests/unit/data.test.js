// Permission tests for member data on D1 (shared/data.js). These replace the
// Supabase row-level-security tests: every rule that used to live in the
// database is now checked here against the Worker.
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeEnv, setRole, signIn } from "./helpers.js";

let env, ana, ben, admin;
beforeEach(async () => {
  env = makeEnv();
  ana = await signIn(env, "ana@example.test", { name: "Ana", username: "ana", phone: "+251900000001" });
  ben = await signIn(env, "ben@example.test", { name: "Ben", username: "ben", phone: "+251900000002" });
  admin = await signIn(env, "boss@example.test", { name: "Boss" });
  setRole(env, "boss@example.test", "admin");
});
const as = (who, path, opts = {}) => call(env, path, { ...opts, token: who.token });
const body = async (r) => r.json();

describe("signed-out requests", () => {
  it("are refused on every member route", async () => {
    for (const [method, path] of [["GET", "/api/data"], ["PUT", "/api/data"], ["GET", "/api/profiles?ids=x"], ["PATCH", "/api/profile"], ["GET", "/api/messages"], ["POST", "/api/messages"], ["POST", "/api/messages/read"], ["POST", "/api/pro/redeem"], ["GET", "/api/admin/members"], ["GET", "/api/admin/codes"]])
      expect((await call(env, path, { method, body: method === "GET" ? undefined : {} })).status, `${method} ${path}`).toBe(401);
  });
});

describe("synced data", () => {
  const records = [
    { entity_type: "transaction", entity_id: "TXN-1", payload: { amount: 250, key: "042917", receiver: "ሳራ" } },
    { entity_type: "contact", entity_id: "c1", payload: { name: "Ben" } },
  ];

  it("round-trips a member's records, Unicode included", async () => {
    expect((await body(await as(ana, "/api/data", { method: "PUT", body: { records } }))).saved).toBe(2);
    const loaded = (await body(await as(ana, "/api/data"))).records;
    expect(loaded).toEqual(expect.arrayContaining(records));
  });

  it("replaces the previous copy instead of appending", async () => {
    await as(ana, "/api/data", { method: "PUT", body: { records } });
    await as(ana, "/api/data", { method: "PUT", body: { records: [records[0]] } });
    expect((await body(await as(ana, "/api/data"))).records).toHaveLength(1);
  });

  it("keeps each member's data private", async () => {
    await as(ana, "/api/data", { method: "PUT", body: { records } });
    expect((await body(await as(ben, "/api/data"))).records).toEqual([]);
    await as(ben, "/api/data", { method: "PUT", body: { records: [] } });
    expect((await body(await as(ana, "/api/data"))).records).toHaveLength(2);
  });

  it("rejects malformed records without changing anything", async () => {
    await as(ana, "/api/data", { method: "PUT", body: { records } });
    for (const bad of [{ records: "nope" }, { records: [{ entity_type: "bad type!", entity_id: "x" }] }, { records: [{ entity_type: "contact", entity_id: "" }] }])
      expect((await as(ana, "/api/data", { method: "PUT", body: bad })).status).toBe(400);
    expect((await body(await as(ana, "/api/data"))).records).toHaveLength(2);
  });

  it("saves large syncs in chunks (more rows than one statement can hold)", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ entity_type: "transaction", entity_id: `T${i}`, payload: { remark: "x".repeat(2000) } }));
    expect((await body(await as(ana, "/api/data", { method: "PUT", body: { records: many } }))).saved).toBe(1200);
    expect((await body(await as(ana, "/api/data"))).records).toHaveLength(1200);
  });

  it("refuses more than 5,000 items", async () => {
    const tooMany = Array.from({ length: 5001 }, (_, i) => ({ entity_type: "contact", entity_id: `c${i}`, payload: {} }));
    expect((await as(ana, "/api/data", { method: "PUT", body: { records: tooMany } })).status).toBe(413);
  });
});

describe("profiles", () => {
  it("never expose phone numbers or emails to other members", async () => {
    const [profile] = (await body(await as(ben, `/api/profiles?ids=${ana.user.id}`))).profiles;
    expect(profile).toMatchObject({ id: ana.user.id, display_name: "Ana", username: "ana" });
    expect(JSON.stringify(profile)).not.toMatch(/\+251|@example/);
  });

  it("can be found by contact code", async () => {
    const [profile] = (await body(await as(ben, `/api/profiles?code=${ana.user.contactCode.toLowerCase()}`))).profiles;
    expect(profile.id).toBe(ana.user.id);
    expect((await body(await as(ben, "/api/profiles?code=NOPE"))).profiles).toEqual([]);
  });

  it("let members change only their own name and country", async () => {
    const r = await as(ana, "/api/profile", { method: "PATCH", body: { name: "Ana B.", country: "Ethiopia", plan: "Pro", role: "admin", contact_code: "VANITY", id: ben.user.id } });
    expect((await body(r)).profile).toMatchObject({ id: ana.user.id, display_name: "Ana B.", country: "Ethiopia", contact_code: ana.user.contactCode });
    const row = env.DB.raw.prepare("SELECT plan, role, display_name FROM users WHERE email = 'ben@example.test'").get();
    expect(row).toMatchObject({ plan: "Free", role: "user", display_name: "Ben" });
  });
});

describe("profile photos", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  it("store small images inline when no R2 bucket is connected", async () => {
    const r = await as(ana, "/api/profile/photo", { method: "PUT", body: png, headers: { "Content-Type": "image/png" } });
    expect((await body(r)).avatarUrl).toMatch(/^data:image\/png;base64,/);
  });
  it("refuse non-images and oversized images", async () => {
    expect((await as(ana, "/api/profile/photo", { method: "PUT", body: png, headers: { "Content-Type": "text/html" } })).status).toBe(415);
    expect((await as(ana, "/api/profile/photo", { method: "PUT", body: new Uint8Array(400_000), headers: { "Content-Type": "image/png" } })).status).toBe(413);
  });
  it("use R2 when connected and serve the image back", async () => {
    const store = new Map();
    env.FILES = {
      put: async (key, value, opts) => store.set(key, { value, opts }),
      get: async (key) => (store.has(key) ? { body: store.get(key).value, httpMetadata: store.get(key).opts.httpMetadata } : null),
    };
    const { avatarUrl } = await body(await as(ana, "/api/profile/photo", { method: "PUT", body: png, headers: { "Content-Type": "image/png" } }));
    expect(avatarUrl).toMatch(new RegExp(`^/api/avatars/${ana.user.id}\\?v=`));
    const served = await call(env, `/api/avatars/${ana.user.id}`);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
  });
});

describe("direct messages", () => {
  const id = () => crypto.randomUUID();

  it("are delivered to the recipient and visible to both sides only", async () => {
    const r = await as(ana, "/api/messages", { method: "POST", body: { id: id(), recipientId: ben.user.id, payload: { text: "hi ben" } } });
    expect(r.status).toBe(200);
    expect((await body(await as(ben, "/api/messages"))).messages.map((m) => m.payload.text)).toEqual(["hi ben"]);
    expect((await body(await as(ana, "/api/messages"))).messages).toHaveLength(1);
    expect((await body(await as(admin, "/api/messages"))).messages).toHaveLength(0);
  });

  it("always use the signed-in member as sender", async () => {
    await as(ana, "/api/messages", { method: "POST", body: { id: id(), recipientId: ben.user.id, senderId: admin.user.id, sender_id: admin.user.id, payload: {} } });
    const [message] = (await body(await as(ben, "/api/messages"))).messages;
    expect(message.sender_id).toBe(ana.user.id);
  });

  it("reject bad ids, unknown recipients, self-messages, repeats and oversized payloads", async () => {
    const send = (b) => as(ana, "/api/messages", { method: "POST", body: b });
    expect((await send({ id: "not-a-uuid", recipientId: ben.user.id })).status).toBe(400);
    expect((await send({ id: id(), recipientId: crypto.randomUUID() })).status).toBe(404);
    expect((await send({ id: id(), recipientId: ana.user.id })).status).toBe(400);
    const fixed = id();
    expect((await send({ id: fixed, recipientId: ben.user.id })).status).toBe(200);
    expect((await send({ id: fixed, recipientId: ben.user.id })).status).toBe(409);
    expect((await send({ id: id(), recipientId: ben.user.id, payload: { voiceUrl: "x".repeat(1_600_000) } })).status).toBe(413);
  });

  it("only new messages are returned after a given time (for polling)", async () => {
    await as(ana, "/api/messages", { method: "POST", body: { id: id(), recipientId: ben.user.id, payload: { n: 1 } } });
    const [first] = (await body(await as(ben, "/api/messages"))).messages;
    expect((await body(await as(ben, `/api/messages?since=${first.created_ms}`))).messages).toEqual([]);
  });

  it("can be marked read only by the recipient", async () => {
    const mid = id();
    await as(ana, "/api/messages", { method: "POST", body: { id: mid, recipientId: ben.user.id, payload: {} } });
    expect((await body(await as(ana, "/api/messages/read", { method: "POST", body: { ids: [mid] } }))).updated).toBe(0);
    expect((await body(await as(ben, "/api/messages/read", { method: "POST", body: { ids: [mid] } }))).updated).toBe(1);
    const [message] = (await body(await as(ben, "/api/messages"))).messages;
    expect(message.read_at).not.toBeNull();
  });
});

describe("Pro access codes", () => {
  it("can be created and listed only by admins", async () => {
    expect((await as(ana, "/api/admin/codes", { method: "POST", body: { code: "SELF-MADE-CODE-1234" } })).status).toBe(403);
    expect((await as(ana, "/api/admin/codes")).status).toBe(403);
    expect((await as(admin, "/api/admin/codes", { method: "POST", body: { code: "SHORT" } })).status).toBe(400);
    const created = (await body(await as(admin, "/api/admin/codes", { method: "POST", body: { code: "dcp-test-0001-abcd" } }))).code;
    expect(created).toMatchObject({ code: "DCP-TEST-0001-ABCD", status: "available" });
    expect((await as(admin, "/api/admin/codes", { method: "POST", body: { code: "DCP-TEST-0001-ABCD" } })).status).toBe(409);
  });

  it("turn a member Pro once, and record who used them", async () => {
    await as(admin, "/api/admin/codes", { method: "POST", body: { code: "DCP-TEST-0002-WXYZ" } });
    expect((await body(await as(ana, "/api/pro/redeem", { method: "POST", body: { code: " dcp-test-0002-wxyz " } }))).status).toBe("used");
    expect((await body(await as(ana, "/api/auth/session"))).user.plan).toBe("Pro");
    expect((await as(ben, "/api/pro/redeem", { method: "POST", body: { code: "DCP-TEST-0002-WXYZ" } })).status).toBe(404);
    expect((await as(ben, "/api/pro/redeem", { method: "POST", body: { code: "NOT-A-CODE" } })).status).toBe(404);
    const [code] = (await body(await as(admin, "/api/admin/codes"))).codes;
    expect(code).toMatchObject({ usedById: ana.user.id, usedBy: "ana@example.test", usedByName: "Ana" });
  });
});

describe("admin members", () => {
  it("are listed and changed only by admins", async () => {
    expect((await as(ana, "/api/admin/members")).status).toBe(403);
    expect((await as(ana, "/api/admin/members", { method: "PATCH", body: { userId: ana.user.id, plan: "Pro" } })).status).toBe(403);
    const members = (await body(await as(admin, "/api/admin/members"))).members;
    expect(members.map((m) => m.email).sort()).toEqual(["ana@example.test", "ben@example.test", "boss@example.test"]);
  });

  it("can change a plan, but not to an unknown value or for an unknown member", async () => {
    expect((await as(admin, "/api/admin/members", { method: "PATCH", body: { userId: ben.user.id, plan: "Pro" } })).status).toBe(200);
    expect((await body(await as(ben, "/api/auth/session"))).user.plan).toBe("Pro");
    expect((await as(admin, "/api/admin/members", { method: "PATCH", body: { userId: ben.user.id, plan: "Gold" } })).status).toBe(400);
    expect((await as(admin, "/api/admin/members", { method: "PATCH", body: { userId: crypto.randomUUID(), plan: "Pro" } })).status).toBe(404);
  });

  it("suspending signs the member out everywhere and blocks every write; reactivating allows sign-in again", async () => {
    expect((await as(admin, "/api/admin/members", { method: "PATCH", body: { userId: ana.user.id, status: "suspended" } })).status).toBe(200);
    expect((await as(ana, "/api/data")).status).toBe(401);
    expect((await as(ana, "/api/messages", { method: "POST", body: { id: crypto.randomUUID(), recipientId: ben.user.id } })).status).toBe(401);
    await expect(signIn(env, "ana@example.test")).rejects.toThrow(/403/);
    await as(admin, "/api/admin/members", { method: "PATCH", body: { userId: ana.user.id, status: "active" } });
    const again = await signIn(env, "ana@example.test");
    expect((await as(again, "/api/data")).status).toBe(200);
  });

  it("cannot change their own status, or use a made-up status", async () => {
    expect((await as(admin, "/api/admin/members", { method: "PATCH", body: { userId: admin.user.id, status: "suspended" } })).status).toBe(400);
    expect((await as(admin, "/api/admin/members", { method: "PATCH", body: { userId: ben.user.id, status: "banned" } })).status).toBe(400);
  });
});
