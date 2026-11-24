// Safety reports, the admin audit log, account export and account deletion.
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeEnv, setRole, signIn } from "./helpers.js";

let env, alice, bob, admin;
const body = (r) => r.json();

async function send(from, to, content) {
  const r = await call(env, "/api/messages", { method: "POST", token: from.token, body: { id: crypto.randomUUID(), recipientId: to.user.id, payload: { content } } });
  expect(r.status).toBe(200);
}

beforeEach(async () => {
  env = makeEnv();
  alice = await signIn(env, "alice@example.com", { name: "Alice" });
  bob = await signIn(env, "bob@example.com", { name: "Bob" });
  admin = await signIn(env, "admin@example.com", { name: "Admin" });
  setRole(env, "admin@example.com", "admin");
});

describe("safety reports", () => {
  it("stores a report with evidence copied from the real conversation", async () => {
    await send(bob, alice, "send me your PIN");
    await send(alice, bob, "no");
    const r = await call(env, "/api/reports", {
      method: "POST",
      token: alice.token,
      // Evidence the app sends is ignored: only the server's copy counts.
      body: { reportedId: bob.user.id, reason: "Scam or fraud attempt", details: "asked for my PIN", includeMessages: true, evidence: [{ text: "fake" }] },
    });
    expect(r.status).toBe(200);
    expect((await body(r)).report.evidenceCount).toBe(2);

    const list = await body(await call(env, "/api/admin/reports", { token: admin.token }));
    expect(list.reports).toHaveLength(1);
    const [report] = list.reports;
    expect(report.reporter.email).toBe("alice@example.com");
    expect(report.reported.email).toBe("bob@example.com");
    expect(report.evidence.map((e) => e.text)).toEqual(["send me your PIN", "no"]);
  });

  it("keeps voice notes out of the evidence", async () => {
    await call(env, "/api/messages", { method: "POST", token: bob.token, body: { id: crypto.randomUUID(), recipientId: alice.user.id, payload: { content: "Voice message", voiceUrl: "data:audio/webm;base64,AAAA" } } });
    await call(env, "/api/reports", { method: "POST", token: alice.token, body: { reportedId: bob.user.id, reason: "Harassment or threats", includeMessages: true } });
    const [report] = (await body(await call(env, "/api/admin/reports", { token: admin.token }))).reports;
    expect(report.evidence[0].text).toBe("[voice note]");
    expect(JSON.stringify(report.evidence)).not.toContain("base64");
  });

  it("rejects bad reports", async () => {
    const post = (b, token = alice.token) => call(env, "/api/reports", { method: "POST", token, body: b });
    expect((await post({ reportedId: alice.user.id, reason: "Spam" })).status).toBe(400);
    expect((await post({ reportedId: bob.user.id, reason: "Because" })).status).toBe(400);
    expect((await post({ reportedId: crypto.randomUUID(), reason: "Spam" })).status).toBe(404);
    expect((await call(env, "/api/reports", { method: "POST", body: { reportedId: bob.user.id, reason: "Spam" } })).status).toBe(401);
  });

  it("limits reports per day", async () => {
    for (let i = 0; i < 20; i++)
      expect((await call(env, "/api/reports", { method: "POST", token: alice.token, body: { reportedId: bob.user.id, reason: "Spam" } })).status).toBe(200);
    expect((await call(env, "/api/reports", { method: "POST", token: alice.token, body: { reportedId: bob.user.id, reason: "Spam" } })).status).toBe(429);
  });

  it("members see only their own reports, without admin notes", async () => {
    await call(env, "/api/reports", { method: "POST", token: alice.token, body: { reportedId: bob.user.id, reason: "Spam" } });
    const mine = (await body(await call(env, "/api/reports", { token: alice.token }))).reports;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ reportedName: "Bob", status: "open" });
    expect(mine[0].adminNote).toBeUndefined();
    expect((await body(await call(env, "/api/reports", { token: bob.token }))).reports).toHaveLength(0);
  });

  it("only admins can list or review reports, and reviews are audited", async () => {
    const { report } = await body(await call(env, "/api/reports", { method: "POST", token: alice.token, body: { reportedId: bob.user.id, reason: "Spam" } }));
    expect((await call(env, "/api/admin/reports", { token: alice.token })).status).toBe(403);
    expect((await call(env, "/api/admin/reports", { method: "PATCH", token: bob.token, body: { id: report.id, status: "dismissed" } })).status).toBe(403);

    const r = await call(env, "/api/admin/reports", { method: "PATCH", token: admin.token, body: { id: report.id, status: "actioned", note: "suspended" } });
    expect(r.status).toBe(200);
    expect((await body(await call(env, "/api/admin/reports?status=open", { token: admin.token }))).reports).toHaveLength(0);
    expect((await body(await call(env, "/api/reports", { token: alice.token }))).reports[0].status).toBe("actioned");

    const { events } = await body(await call(env, "/api/admin/audit", { token: admin.token }));
    expect(events[0]).toMatchObject({ action: "report.review", targetId: report.id, adminEmail: "admin@example.com", detail: { status: "actioned" } });
  });
});

describe("admin audit log", () => {
  it("records member changes and new codes, never the full code", async () => {
    await call(env, "/api/admin/members", { method: "PATCH", token: admin.token, body: { userId: bob.user.id, plan: "Pro" } });
    await call(env, "/api/admin/codes", { method: "POST", token: admin.token, body: { code: "CASH-ABCDEF-123456" } });
    const { events } = await body(await call(env, "/api/admin/audit", { token: admin.token }));
    expect(events.map((e) => e.action).sort()).toEqual(["code.create", "member.update"]);
    expect(events.find((e) => e.action === "member.update")).toMatchObject({ targetId: bob.user.id, detail: { plan: "Pro" } });
    expect(JSON.stringify(events)).not.toContain("CASH-ABCDEF-123456");
    expect(events.find((e) => e.action === "code.create").detail.codeEnding).toBe("3456");
  });

  it("is admin only", async () => {
    expect((await call(env, "/api/admin/audit", { token: alice.token })).status).toBe(403);
    expect((await call(env, "/api/admin/audit")).status).toBe(401);
  });
});

describe("account export", () => {
  it("includes the member's own data and messages, nothing of other members", async () => {
    await call(env, "/api/data", { method: "PUT", token: alice.token, body: { records: [{ entity_type: "records", entity_id: "r1", payload: { amount: 50 } }] } });
    await send(alice, bob, "hi bob");
    await send(bob, admin, "private to admin");
    const r = await call(env, "/api/account/export", { token: alice.token });
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const data = await body(r);
    expect(data.format).toBe("datachat-account-export");
    expect(data.account.email).toBe("alice@example.com");
    expect(data.records).toEqual([expect.objectContaining({ type: "records", id: "r1", payload: { amount: 50 } })]);
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0]).toMatchObject({ direction: "sent", otherMemberId: bob.user.id });
    expect(JSON.stringify(data)).not.toContain("private to admin");
    expect(JSON.stringify(data)).not.toContain("bob@example.com");
  });

  it("needs a signed-in member", async () => {
    expect((await call(env, "/api/account/export")).status).toBe(401);
  });
});

describe("account deletion", () => {
  it("needs the member's email typed exactly", async () => {
    const r = await call(env, "/api/account/delete", { method: "POST", token: alice.token, body: { confirmEmail: "bob@example.com" } });
    expect(r.status).toBe(400);
    expect((await call(env, "/api/auth/session", { token: alice.token })).status).toBe(200);
  });

  it("removes the account, its sessions, data and messages", async () => {
    await call(env, "/api/data", { method: "PUT", token: alice.token, body: { records: [{ entity_type: "records", entity_id: "r1", payload: {} }] } });
    await send(alice, bob, "bye");
    await call(env, "/api/reports", { method: "POST", token: bob.token, body: { reportedId: alice.user.id, reason: "Spam" } });

    const r = await call(env, "/api/account/delete", { method: "POST", token: alice.token, body: { confirmEmail: "ALICE@example.com " } });
    expect(r.status).toBe(200);
    expect(r.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    expect((await call(env, "/api/auth/session", { token: alice.token })).status).toBe(401);

    const count = (sql) => env.DB.raw.prepare(sql).get(alice.user.id).n;
    expect(count("SELECT COUNT(*) AS n FROM users WHERE id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM app_data WHERE user_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM direct_messages WHERE sender_id = ?")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM member_reports WHERE reported_id = ?")).toBe(0);
    // Bob's account is untouched.
    expect((await call(env, "/api/auth/session", { token: bob.token })).status).toBe(200);
  });

  it("keeps the last admin from deleting themself", async () => {
    const r = await call(env, "/api/account/delete", { method: "POST", token: admin.token, body: { confirmEmail: "admin@example.com" } });
    expect(r.status).toBe(409);
    setRole(env, "bob@example.com", "admin");
    expect((await call(env, "/api/account/delete", { method: "POST", token: admin.token, body: { confirmEmail: "admin@example.com" } })).status).toBe(200);
  });

  it("the audit log outlives a deleted admin", async () => {
    setRole(env, "bob@example.com", "admin");
    await call(env, "/api/admin/members", { method: "PATCH", token: admin.token, body: { userId: alice.user.id, plan: "Pro" } });
    await call(env, "/api/account/delete", { method: "POST", token: admin.token, body: { confirmEmail: "admin@example.com" } });
    const { events } = await body(await call(env, "/api/admin/audit", { token: bob.token }));
    expect(events[0]).toMatchObject({ adminId: null, adminEmail: "admin@example.com", action: "member.update" });
  });
});
