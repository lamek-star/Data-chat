import { beforeEach, describe, expect, it } from "vitest";
import { effectivePlan, TRIAL_MS } from "../../shared/auth.js";
import { adminCall, adminSignIn, call, makeEnv, setRole, signIn } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
let env;
beforeEach(() => {
  env = makeEnv();
});
const session = async (who) => (await (await call(env, "/api/auth/session", { token: who.token })).json()).user;

describe("3-month Pro trial", () => {
  it("gives every new account Pro for 90 days", async () => {
    const before = Date.now();
    const ana = await signIn(env, "ana@example.test");
    const user = await session(ana);
    expect(user).toMatchObject({ plan: "Pro", trial: true });
    const until = new Date(user.proUntil).getTime();
    expect(until - before).toBeGreaterThanOrEqual(TRIAL_MS - 1000);
    expect(until - before).toBeLessThanOrEqual(TRIAL_MS + 60_000);
    expect(TRIAL_MS).toBe(90 * DAY);
  });

  it("drops to Free when the trial ends", async () => {
    const ana = await signIn(env, "ana@example.test");
    env.DB.raw.prepare("UPDATE users SET pro_until = ? WHERE email = 'ana@example.test'").run(Date.now() - 1000);
    expect(await session(ana)).toMatchObject({ plan: "Free", trial: false });
  });

  it("is not reset by signing in again", async () => {
    await signIn(env, "ana@example.test");
    env.DB.raw.prepare("UPDATE users SET pro_until = ? WHERE email = 'ana@example.test'").run(Date.now() - 1000);
    const again = await signIn(env, "ana@example.test");
    expect((await session(again)).plan).toBe("Free");
  });

  it("is replaced by permanent Pro after paying or redeeming a code", async () => {
    const boss = await signIn(env, "boss@example.test");
    setRole(env, "boss@example.test", "admin");
    boss.adminCookie = await adminSignIn(env, "boss@example.test");
    await adminCall(env, "/api/admin/codes", { method: "POST", body: { code: "DCP-TRIAL-TEST-0001" }, cookie: boss.adminCookie });
    const ana = await signIn(env, "ana@example.test");
    await call(env, "/api/pro/redeem", { method: "POST", body: { code: "DCP-TRIAL-TEST-0001" }, token: ana.token });
    env.DB.raw.prepare("UPDATE users SET pro_until = ? WHERE email = 'ana@example.test'").run(Date.now() - 1000);
    expect(await session(ana)).toMatchObject({ plan: "Pro", trial: false, proUntil: null });
  });

  it("ends when an admin sets the member to Free, and admins see the end date", async () => {
    const boss = await signIn(env, "boss@example.test");
    setRole(env, "boss@example.test", "admin");
    boss.adminCookie = await adminSignIn(env, "boss@example.test");
    const ana = await signIn(env, "ana@example.test");
    const listed = (await (await adminCall(env, "/api/admin/members", { cookie: boss.adminCookie })).json()).members.find((m) => m.email === "ana@example.test");
    expect(listed).toMatchObject({ plan: "Pro", trial: true });
    expect(listed.proUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await adminCall(env, "/api/admin/members", { method: "PATCH", body: { userId: ana.user.id, plan: "Free" }, cookie: boss.adminCookie });
    expect(await session(ana)).toMatchObject({ plan: "Free", trial: false });
  });

  it("works out the plan from the stored row", () => {
    const now = Date.UTC(2026, 10, 23);
    expect(effectivePlan({ plan: "Pro", pro_until: null }, now)).toEqual({ plan: "Pro", trial: false, proUntil: null });
    expect(effectivePlan({ plan: "Free", pro_until: now + 1 }, now)).toMatchObject({ plan: "Pro", trial: true });
    expect(effectivePlan({ plan: "Free", pro_until: now - 1 }, now)).toMatchObject({ plan: "Free", trial: false });
    expect(effectivePlan({ plan: "Free", pro_until: null }, now)).toEqual({ plan: "Free", trial: false, proUntil: null });
  });
});
