/**
 * Keeps the signed-in member's data on this device so DataChat opens and
 * shows records, contacts and messages with no internet (and instantly on a
 * slow one). Stored in IndexedDB, one snapshot per member:
 *   { userId, db, dirty, savedAt }
 * `dirty` means the snapshot has changes the server hasn't accepted yet
 * (made offline); they are uploaded when the connection returns.
 * Signing out erases the member's snapshot: a shared phone keeps nothing.
 */
const DB_NAME = "datachat-offline";
const STORE = "snapshots";
const LAST_USER_KEY = "dc-last-user";

let opening;
function openDb(idb = globalThis.indexedDB) {
  if (!idb) return Promise.reject(new Error("IndexedDB unavailable"));
  opening ||= new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "userId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = undefined;
      reject(request.error);
    };
  });
  return opening;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function lastUserId() {
  try {
    return localStorage.getItem(LAST_USER_KEY) || null;
  } catch {
    return null;
  }
}

export async function loadSnapshot(userId) {
  if (!userId) return null;
  try {
    const snapshot = await run("readonly", (store) => store.get(userId));
    return snapshot?.db?.users?.length ? snapshot : null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(userId, db, { dirty }) {
  if (!userId || !db) return;
  try {
    localStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    /* the snapshot can still be found once the member signs in */
  }
  try {
    // Keep `dirty` once set until the server confirms (markClean).
    const previous = dirty ? null : await run("readonly", (store) => store.get(userId));
    await run("readwrite", (store) =>
      store.put({ userId, db, dirty: Boolean(dirty || previous?.dirty), savedAt: Date.now() }),
    );
  } catch {
    /* storage full or blocked: the app still works online */
  }
}

export async function markClean(userId) {
  try {
    const snapshot = await run("readonly", (store) => store.get(userId));
    if (snapshot?.dirty) await run("readwrite", (store) => store.put({ ...snapshot, dirty: false }));
  } catch {
    /* next successful save will try again */
  }
}

/** Sign-out: erase everything this member had on the device. */
export async function clearSnapshot(userId) {
  try {
    if (lastUserId() === userId) localStorage.removeItem(LAST_USER_KEY);
  } catch {
    /* nothing to clear */
  }
  try {
    if (userId) await run("readwrite", (store) => store.delete(userId));
  } catch {
    /* nothing stored */
  }
}

/**
 * After coming back online with offline changes: keep the member's own
 * edits (records, contacts, notices) and take messages from the server,
 * plus anything only this device has (e.g. messages still in the outbox).
 */
export function mergeOfflineChanges(local, server) {
  const byId = (list) => new Map((list || []).map((item) => [item.id, item]));
  const serverMessages = byId(server.messages);
  const localOnlyMessages = (local.messages || []).filter((m) => !serverMessages.has(m.id) && m.sender === "me");
  return {
    ...server,
    records: local.records ?? server.records,
    contacts: local.contacts ?? server.contacts,
    notifications: local.notifications ?? server.notifications,
    accessCodes: local.accessCodes ?? server.accessCodes,
    messages: [...server.messages, ...localOnlyMessages],
  };
}
