// Shared rate offers and communities (shared/community.js): who can see,
// post, approve and change what.
import { beforeEach, describe, expect, it } from "vitest";
import { adminCall, adminSignIn, call, makeEnv, setRole, signIn } from "./helpers.js";

let env, ana, ben, boss, bossCookie;
beforeEach(async () => {
  env = makeEnv();
  ana = await signIn(env, "ana@example.test", { name: "Ana" });
  ben = await signIn(env, "ben@example.test", { name: "Ben" });
  boss = await signIn(env, "boss@example.test", { name: "Boss" });
  setRole(env, "boss@example.test", "admin");
  bossCookie = await adminSignIn(env, "boss@example.test");
});
const as = (who, path, opts = {}) => call(env, path, { ...opts, token: who.token });
const json = (r) => r.json();
const offer = (extra = {}) => ({
  provider: "Ana Exchange",
  contact: "@ana",
  location: "Dubai",
  side: "Sell",
  fromCurrency: "aed",
  toCurrency: "ETB",
  rate: 41.2,
  min: 100,
  max: 5000,
  instrument: "Cash pickup",
  note: "ID required.",
  ...extra,
});

describe("rate offers", () => {
  it("wait for an administrator before anyone else sees them", async () => {
    const r = await as(ana, "/api/rates/offers", { method: "POST", body: offer() });
    expect(r.status).toBe(200);
    const { offer: posted } = await json(r);
    expect(posted).toMatchObject({ status: "pending", fromCurrency: "AED", mine: true, verified: false });

    // Ana sees her own pending offer; Ben sees nothing yet.
    expect((await json(await as(ana, "/api/rates/offers"))).offers.map((o) => o.id)).toEqual([posted.id]);
    expect((await json(await as(ben, "/api/rates/offers"))).offers).toEqual([]);

    // The admin approves it in the dashboard.
    const queue = (await json(await adminCall(env, "/api/admin/offers?status=pending", { cookie: bossCookie }))).offers;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ ownerName: "Ana", ownerEmail: "ana@example.test" });
    expect((await adminCall(env, "/api/admin/offers", { method: "PATCH", cookie: bossCookie, body: { id: posted.id, status: "approved" } })).status).toBe(200);

    const seenByBen = (await json(await as(ben, "/api/rates/offers"))).offers;
    expect(seenByBen).toHaveLength(1);
    expect(seenByBen[0]).toMatchObject({ provider: "Ana Exchange", verified: true, mine: false, ownerId: ana.user.id });
    expect(seenByBen[0].adminNote).toBeUndefined();
    const { events } = await json(await adminCall(env, "/api/admin/audit", { cookie: bossCookie }));
    expect(events.some((e) => e.action === "offer.review" && e.targetId === posted.id)).toBe(true);
  });

  it("stay hidden when rejected, expire after 30 days, and vanish when withdrawn", async () => {
    const a = (await json(await as(ana, "/api/rates/offers", { method: "POST", body: offer() }))).offer;
    await adminCall(env, "/api/admin/offers", { method: "PATCH", cookie: bossCookie, body: { id: a.id, status: "rejected", note: "Rate looks wrong" } });
    expect((await json(await as(ben, "/api/rates/offers"))).offers).toEqual([]);
    expect((await json(await as(ana, "/api/rates/offers"))).offers[0]).toMatchObject({ status: "rejected", adminNote: "Rate looks wrong" });

    const b = (await json(await as(ana, "/api/rates/offers", { method: "POST", body: offer({ rate: 41.5 }) }))).offer;
    await adminCall(env, "/api/admin/offers", { method: "PATCH", cookie: bossCookie, body: { id: b.id, status: "approved" } });
    env.DB.raw.prepare("UPDATE rate_offers SET expires_at = ? WHERE id = ?").run(Date.now() - 1, b.id);
    expect((await json(await as(ben, "/api/rates/offers"))).offers).toEqual([]);

    const c = (await json(await as(ana, "/api/rates/offers", { method: "POST", body: offer({ rate: 42 }) }))).offer;
    await adminCall(env, "/api/admin/offers", { method: "PATCH", cookie: bossCookie, body: { id: c.id, status: "approved" } });
    expect((await as(ben, "/api/rates/offers/withdraw", { method: "POST", body: { id: c.id } })).status).toBe(404); // not Ben's
    expect((await as(ana, "/api/rates/offers/withdraw", { method: "POST", body: { id: c.id } })).status).toBe(200);
    expect((await json(await as(ben, "/api/rates/offers"))).offers).toEqual([]);
  });

  it("hide an approved offer while its owner is suspended", async () => {
    const a = (await json(await as(ana, "/api/rates/offers", { method: "POST", body: offer() }))).offer;
    await adminCall(env, "/api/admin/offers", { method: "PATCH", cookie: bossCookie, body: { id: a.id, status: "approved" } });
    env.DB.raw.prepare("UPDATE users SET status = 'suspended' WHERE email = 'ana@example.test'").run();
    expect((await json(await as(ben, "/api/rates/offers"))).offers).toEqual([]);
  });

  it("reject bad input and limit how many can wait at once", async () => {
    for (const bad of [offer({ side: "Steal" }), offer({ rate: 0 }), offer({ rate: "abc" }), offer({ max: 10, min: 100 }), offer({ toCurrency: "AED" }), offer({ fromCurrency: "<script>" }), offer({ provider: "" }), offer({ note: "x".repeat(501) })])
      expect((await as(ana, "/api/rates/offers", { method: "POST", body: bad })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await as(ana, "/api/rates/offers", { method: "POST", body: offer({ rate: 40 + i }) })).status).toBe(200);
    expect((await as(ana, "/api/rates/offers", { method: "POST", body: offer({ rate: 50 }) })).status).toBe(429);
  });

  it("can only be reviewed by an administrator in the dashboard", async () => {
    const a = (await json(await as(ana, "/api/rates/offers", { method: "POST", body: offer() }))).offer;
    expect((await call(env, "/api/admin/offers", { token: boss.token })).status).toBe(404); // never on the app host
    expect((await adminCall(env, "/api/admin/offers", { method: "PATCH", body: { id: a.id, status: "approved" } })).status).toBe(401);
    expect((await adminCall(env, "/api/admin/offers", { method: "PATCH", cookie: bossCookie, body: { id: a.id, status: "live" } })).status).toBe(400);
    expect((await call(env, "/api/rates/offers")).status).toBe(401);
  });
});

describe("communities", () => {
  const list = async (who) => (await json(await as(who, "/api/communities"))).communities;
  const find = async (who, name) => (await list(who)).find((c) => c.name === name);

  it("start with the two administrator communities, which anyone can join straight away", async () => {
    const all = await list(ana);
    expect(all.map((c) => c.name)).toEqual(["DataChat Global Community", "UAE Habesha Network"]);
    expect(all[0]).toMatchObject({ adminRun: true, allowSubgroups: true, myRole: null });
    expect(await json(await as(ana, "/api/communities/join", { method: "POST", body: { id: "community-uae" } }))).toEqual({ status: "member" });
    expect((await find(ana, "UAE Habesha Network")).myRole).toBe("member");
    expect((await find(ben, "UAE Habesha Network")).memberCount).toBe(1);
  });

  it("let a member create a group; joining it needs the owner's approval", async () => {
    const create = await as(ana, "/api/communities", {
      method: "POST",
      body: { parentId: "community-uae", name: "Deira Senders", location: "Deira, Dubai", purpose: "Weekly cash handoffs in Deira." },
    });
    expect(create.status).toBe(200);
    const group = await find(ana, "Deira Senders");
    expect(group).toMatchObject({ level: 2, myRole: "owner", canManage: true, parentId: "community-uae", memberCount: 1 });

    expect(await json(await as(ben, "/api/communities/join", { method: "POST", body: { id: group.id } }))).toEqual({ status: "pending" });
    expect((await find(ben, "Deira Senders")).myRequest).toBe("pending");
    const waiting = (await find(ana, "Deira Senders")).pendingRequests;
    expect(waiting).toEqual([expect.objectContaining({ userId: ben.user.id, name: "Ben" })]);

    // Only the owner decides: not Ben, not another member.
    expect((await as(ben, "/api/communities/decide", { method: "POST", body: { id: group.id, userId: ben.user.id, approve: true } })).status).toBe(403);
    expect((await as(ana, "/api/communities/decide", { method: "POST", body: { id: group.id, userId: ben.user.id, approve: true } })).status).toBe(200);
    expect((await find(ben, "Deira Senders")).myRole).toBe("member");
    expect((await find(ana, "Deira Senders")).pendingRequests).toEqual([]);
    expect((await as(ana, "/api/communities/decide", { method: "POST", body: { id: group.id, userId: ben.user.id, approve: true } })).status).toBe(404);

    // Members can leave; the owner can't.
    expect((await as(ben, "/api/communities/leave", { method: "POST", body: { id: group.id } })).status).toBe(200);
    expect((await find(ben, "Deira Senders")).myRole).toBeNull();
    expect((await as(ana, "/api/communities/leave", { method: "POST", body: { id: group.id } })).status).toBe(400);
  });

  it("let an owner decline, and the member ask again later", async () => {
    await as(ana, "/api/communities", { method: "POST", body: { parentId: "community-uae", name: "Sharjah Group", location: "Sharjah", purpose: "Sharjah members helping each other." } });
    const group = await find(ana, "Sharjah Group");
    await as(ben, "/api/communities/join", { method: "POST", body: { id: group.id } });
    await as(ana, "/api/communities/decide", { method: "POST", body: { id: group.id, userId: ben.user.id, approve: false } });
    expect((await find(ben, "Sharjah Group")).myRequest).toBe("declined");
    expect(await json(await as(ben, "/api/communities/join", { method: "POST", body: { id: group.id } }))).toEqual({ status: "pending" });
  });

  it("only allow groups under communities that accept them, with valid details", async () => {
    await as(ana, "/api/communities", { method: "POST", body: { parentId: "community-uae", name: "Closed Group", location: "Dubai", purpose: "A group that takes no subgroups." } });
    const closed = await find(ana, "Closed Group");
    expect((await as(ben, "/api/communities", { method: "POST", body: { parentId: closed.id, name: "Below closed", location: "Dubai", purpose: "Should not be allowed here." } })).status).toBe(400);
    expect((await as(ben, "/api/communities", { method: "POST", body: { parentId: "nope-missing", name: "Lost", location: "Dubai", purpose: "Parent does not exist at all." } })).status).toBe(404);
    expect((await as(ben, "/api/communities", { method: "POST", body: { parentId: "community-uae", name: "x", location: "Dubai", purpose: "short" } })).status).toBe(400);
  });

  it("are created and archived by administrators in the dashboard", async () => {
    const r = await adminCall(env, "/api/admin/communities", {
      method: "POST",
      cookie: bossCookie,
      body: { name: "Ethiopians in Saudi Arabia", location: "Saudi Arabia", purpose: "Support and trusted transfers across KSA.", allowSubgroups: true },
    });
    expect(r.status).toBe(200);
    const created = await find(ana, "Ethiopians in Saudi Arabia");
    expect(created).toMatchObject({ level: 0, adminRun: true, allowSubgroups: true });

    expect((await adminCall(env, "/api/admin/communities", { method: "PATCH", cookie: bossCookie, body: { id: created.id, status: "archived" } })).status).toBe(200);
    expect(await find(ana, "Ethiopians in Saudi Arabia")).toBeUndefined();
    expect((await as(ana, "/api/communities/join", { method: "POST", body: { id: created.id } })).status).toBe(404);
    const all = (await json(await adminCall(env, "/api/admin/communities", { cookie: bossCookie }))).communities;
    expect(all.find((c) => c.id === created.id).status).toBe("archived");
    expect((await adminCall(env, "/api/admin/communities", { method: "POST", body: { name: "x" } })).status).toBe(401);
  });
});

describe("dashboard numbers", () => {
  it("count offers waiting for approval and active communities", async () => {
    await as(ana, "/api/rates/offers", { method: "POST", body: offer() });
    const { stats } = await json(await adminCall(env, "/api/admin/stats", { cookie: bossCookie }));
    expect(stats.offers).toEqual({ pending: 1, live: 0 });
    expect(stats.communities.active).toBe(2);
  });
});
