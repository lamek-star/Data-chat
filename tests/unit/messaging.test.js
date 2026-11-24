import { describe, expect, it, vi } from "vitest";
import { createSyncQueue } from "../../src/cloud/syncQueue.js";
import { createOutbox, localOutboxStorage } from "../../src/cloud/outbox.js";
import { contactLink, normalizeContactCode, parseContactScan, scanProblem } from "../../src/contactScan.js";
import { lastMessageByContact, messagePreview, totalUnread, unreadByContact } from "../../src/notify.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Manual timers: run() fires the next pending timer. */
function fakeTimers() {
  const timers = [];
  return {
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
    },
    async run() {
      const t = timers.shift();
      if (!t) return false;
      await t.fn();
      await flush();
      return t.ms;
    },
    get pending() {
      return timers.map((t) => t.ms);
    },
  };
}

describe("sync queue (slow-network uploads)", () => {
  it("coalesces quick changes into one upload of the latest data", async () => {
    const timers = fakeTimers();
    const send = vi.fn().mockResolvedValue();
    const q = createSyncQueue({ send, ...timers });
    q.schedule([{ id: 1 }]);
    q.schedule([{ id: 1 }, { id: 2 }]);
    q.schedule([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await timers.run();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("skips the upload when nothing synced changed", async () => {
    const timers = fakeTimers();
    const send = vi.fn().mockResolvedValue();
    const q = createSyncQueue({ send, ...timers });
    q.markSynced([{ id: 1 }]);
    q.schedule([{ id: 1 }]);
    await timers.run();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps one upload in flight and sends the newest data after it (order preserved)", async () => {
    const timers = fakeTimers();
    let release;
    const sent = [];
    const send = vi.fn((rows) => {
      sent.push(rows);
      return sent.length === 1 ? new Promise((r) => (release = r)) : Promise.resolve();
    });
    const q = createSyncQueue({ send, ...timers });
    q.schedule(["a"]);
    const first = timers.run();
    await flush();
    q.schedule(["a", "b"]);
    q.schedule(["a", "b", "c"]);
    expect(send).toHaveBeenCalledTimes(1); // second waits for the first
    release();
    await first;
    await timers.run();
    expect(sent).toEqual([["a"], ["a", "b", "c"]]);
  });

  it("retries a failed upload with backoff and reports errors", async () => {
    const timers = fakeTimers();
    const onError = vi.fn();
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error("offline"), { status: 0 })).mockResolvedValue();
    const q = createSyncQueue({ send, onError, retryMs: [2000, 5000], ...timers });
    q.schedule(["x"]);
    await timers.run();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(timers.pending).toEqual([2000]);
    await timers.run();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(["x"]);
  });

  it("does not resend stale data over newer data after a failure", async () => {
    const timers = fakeTimers();
    let reject;
    const send = vi.fn().mockImplementationOnce(() => new Promise((_, r) => (reject = r))).mockResolvedValue();
    const q = createSyncQueue({ send, ...timers });
    q.schedule(["old"]);
    const first = timers.run();
    await flush();
    q.schedule(["new"]);
    reject(new Error("timeout"));
    await first;
    await timers.run();
    expect(send).toHaveBeenLastCalledWith(["new"]);
  });
});

function memoryStorage(initial = []) {
  let items = initial;
  return {
    get: () => items,
    set: (next) => (items = next),
    get items() {
      return items;
    },
  };
}

describe("message outbox", () => {
  it("sends in order and reports sending -> sent", async () => {
    const timers = fakeTimers();
    const storage = memoryStorage();
    const statuses = [];
    const send = vi.fn().mockResolvedValue({ id: "row" });
    const box = createOutbox({ send, storage, onStatus: (id, s) => statuses.push([id, s]), ...timers, isOnline: () => true });
    box.push({ id: "m1", recipientId: "r", message: {} });
    box.push({ id: "m2", recipientId: "r", message: {} });
    await flush();
    await flush();
    expect(send.mock.calls.map((c) => c[0].id)).toEqual(["m1", "m2"]);
    expect(statuses).toContainEqual(["m1", "sent"]);
    expect(statuses).toContainEqual(["m2", "sent"]);
    expect(storage.items).toEqual([]);
  });

  it("keeps a message on a network error and retries it", async () => {
    const timers = fakeTimers();
    const storage = memoryStorage();
    const statuses = [];
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error("slow"), { status: 0 })).mockResolvedValue({});
    const box = createOutbox({ send, storage, onStatus: (id, s) => statuses.push(s), ...timers, isOnline: () => true });
    box.push({ id: "m1", recipientId: "r", message: {} });
    await flush();
    expect(statuses).toContain("waiting");
    expect(storage.items.map((x) => x.id)).toEqual(["m1"]); // survives a reload
    expect(timers.pending[0]).toBeGreaterThan(0);
    await timers.run();
    expect(statuses.at(-1)).toBe("sent");
    expect(storage.items).toEqual([]);
  });

  it("treats 409 (already sent) as delivered: the reply was lost, not the message", async () => {
    const storage = memoryStorage();
    const statuses = [];
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { status: 409 }));
    const box = createOutbox({ send, storage, onStatus: (id, s) => statuses.push(s), isOnline: () => true });
    box.push({ id: "m1", recipientId: "r", message: {} });
    await flush();
    expect(statuses.at(-1)).toBe("sent");
    expect(storage.items).toEqual([]);
  });

  it("marks a refused message failed without blocking the next one", async () => {
    const storage = memoryStorage();
    const statuses = [];
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Unknown recipient."), { status: 404 }))
      .mockResolvedValue({});
    const box = createOutbox({ send, storage, onStatus: (id, s) => statuses.push([id, s]), isOnline: () => true });
    box.push({ id: "bad", recipientId: "x", message: {} });
    box.push({ id: "good", recipientId: "r", message: {} });
    await flush();
    await flush();
    expect(statuses).toContainEqual(["bad", "failed"]);
    expect(statuses).toContainEqual(["good", "sent"]);
  });

  it("waits while offline and sends when retryNow is called (network back)", async () => {
    const storage = memoryStorage();
    let online = false;
    const statuses = [];
    const send = vi.fn().mockResolvedValue({});
    const box = createOutbox({ send, storage, onStatus: (id, s) => statuses.push(s), isOnline: () => online });
    box.push({ id: "m1", recipientId: "r", message: {} });
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(statuses).toEqual(["waiting"]);
    online = true;
    box.retryNow();
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("sent");
  });

  it("resumes messages saved before a reload", async () => {
    const storage = memoryStorage([{ id: "m1", recipientId: "r", message: { content: "hi" } }]);
    const send = vi.fn().mockResolvedValue({});
    const box = createOutbox({ send, storage, isOnline: () => true });
    expect(box.pending().map((x) => x.id)).toEqual(["m1"]);
    box.retryNow();
    await flush();
    expect(send).toHaveBeenCalledWith({ id: "m1", recipientId: "r", message: { content: "hi" } });
  });

  it("stores the outbox per member in localStorage-like storage", () => {
    const map = new Map();
    const store = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
    const s = localOutboxStorage("u1", store);
    s.set([{ id: "a" }]);
    expect(JSON.parse(map.get("dc-outbox-u1"))).toEqual([{ id: "a" }]);
    expect(s.get()).toEqual([{ id: "a" }]);
    s.set([]);
    expect(map.has("dc-outbox-u1")).toBe(false);
    map.set("dc-outbox-u1", "not json");
    expect(s.get()).toEqual([]);
  });
});

describe("contact scanning", () => {
  it("reads the contact link any phone camera opens", () => {
    const link = contactLink("https://datachat.harmongt.uk", "1A2B3C4D5E6F");
    expect(link).toBe("https://datachat.harmongt.uk/?add=1A2B3C4D5E6F");
    expect(parseContactScan(link)).toEqual({ contactCode: "1A2B3C4D5E6F" });
  });

  it("still reads the older JSON contact QR", () => {
    const userId = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";
    expect(parseContactScan(JSON.stringify({ type: "datachat-user-contact", userId, contactCode: "abcd efgh ijkl" }))).toEqual({
      userId,
      contactCode: "ABCDEFGHIJKL",
    });
  });

  it("accepts a typed code with spaces, dashes or lower case", () => {
    expect(normalizeContactCode(" 1a2b-3c4d 5e6f ")).toBe("1A2B3C4D5E6F");
    expect(parseContactScan("1a2b 3c4d 5e6f")).toEqual({ contactCode: "1A2B3C4D5E6F" });
    expect(normalizeContactCode("abc")).toBe("");
    expect(normalizeContactCode("<script>")).toBe("");
  });

  it("explains QR codes that are not a member's contact", () => {
    expect(parseContactScan(JSON.stringify({ type: "datachat-transaction-record" })).kind).toBe("transaction");
    expect(parseContactScan(JSON.stringify({ type: "datachat-contact", name: "x" })).kind).toBe("saved-contact");
    expect(parseContactScan("https://datachat.harmongt.uk/?seal=DCS1:abc.def")).toEqual({ kind: "seal", value: "DCS1:abc.def" });
    expect(parseContactScan("https://example.com/").kind).toBe("unknown");
    expect(parseContactScan("{not json").kind).toBe("unknown");
    expect(parseContactScan("   ").kind).toBe("empty");
    for (const kind of ["transaction", "seal", "saved-contact", "empty", "unknown"]) expect(scanProblem(kind)).toMatch(/\w/);
  });
});

describe("unread counts and previews", () => {
  const messages = [
    { id: "1", owner: "me", contact: "a", sender: "them", unread: true, content: "hi" },
    { id: "2", owner: "me", contact: "a", sender: "them", unread: true, content: "there" },
    { id: "3", owner: "me", contact: "b", sender: "them", unread: false, content: "old" },
    { id: "4", owner: "me", contact: "b", sender: "me", content: "reply", transaction: { reference: "TXN-1" } },
    { id: "5", owner: "other", contact: "a", sender: "them", unread: true, content: "not mine" },
  ];
  it("counts unread incoming messages per conversation, for this member only", () => {
    const counts = unreadByContact(messages, "me");
    expect(counts).toEqual({ a: 2 });
    expect(totalUnread(counts)).toBe(2);
  });
  it("finds the latest message per conversation for previews and sorting", () => {
    const last = lastMessageByContact(messages, "me");
    expect(last.a.message.id).toBe("2");
    expect(last.b.message.id).toBe("4");
    expect(last.b.order).toBeGreaterThan(last.a.order);
    expect(messagePreview(last.b.message)).toBe("Transaction TXN-1");
    expect(messagePreview({ voiceUrl: "data:" })).toBe("Voice message");
    expect(messagePreview({ content: "a\n  b" })).toBe("a b");
  });
});

describe("offline changes after reconnecting", async () => {
  const { mergeOfflineChanges } = await import("../../src/cloud/localCache.js");
  it("keeps edits made offline and takes new messages from the server", () => {
    const local = {
      users: [{ id: "me" }],
      records: [{ id: "TXN-OFFLINE" }, { id: "TXN-1", status: "Verified" }],
      contacts: [{ id: "c1" }, { id: "c-new" }],
      notifications: [],
      accessCodes: [],
      messages: [
        { id: "m1", sender: "them", content: "old" },
        { id: "queued", sender: "me", content: "written offline", deliveryStatus: "waiting" },
      ],
    };
    const server = {
      users: [{ id: "me", plan: "Pro" }],
      records: [{ id: "TXN-1", status: "Pending" }],
      contacts: [{ id: "c1" }],
      notifications: [],
      accessCodes: [],
      messages: [
        { id: "m1", sender: "them", content: "old" },
        { id: "m2", sender: "them", content: "arrived while offline" },
      ],
    };
    const merged = mergeOfflineChanges(local, server);
    expect(merged.users).toEqual(server.users); // plan comes from the server
    expect(merged.records.map((r) => r.id)).toEqual(["TXN-OFFLINE", "TXN-1"]);
    expect(merged.records[1].status).toBe("Verified");
    expect(merged.contacts.map((c) => c.id)).toEqual(["c1", "c-new"]);
    expect(merged.messages.map((m) => m.id)).toEqual(["m1", "m2", "queued"]);
  });
});
