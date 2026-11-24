/**
 * Message outbox: chat messages to other members are kept on this device
 * until the server confirms them, so a slow or dropped connection never
 * loses a message. Messages go out one at a time, in the order written,
 * and are retried automatically (sooner when the device comes back online).
 *
 * The server refuses a repeated message id with 409 "already sent": that
 * means an earlier attempt did arrive (only the reply was lost), so it
 * counts as delivered, not as a failure.
 */
export const RETRY_MS = [1500, 3000, 6000, 12000, 30000];

const PERMANENT = new Set([400, 401, 403, 404, 413]);

export function createOutbox({
  send, // async (item) => serverRow
  storage, // { get(): item[], set(items) }
  onStatus = () => {}, // (id, status, row?) status: sending|waiting|sent|failed
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
} = {}) {
  let queue = storage.get() || [];
  let running = false;
  let timer = null;
  let failures = 0;

  const persist = () => storage.set(queue);
  const remove = (id) => {
    queue = queue.filter((item) => item.id !== id);
    persist();
  };

  const arm = (ms) => {
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      drain();
    }, ms);
  };

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const item = queue[0];
        if (!isOnline()) {
          onStatus(item.id, "waiting");
          return; // the "online" event calls retryNow()
        }
        onStatus(item.id, "sending");
        try {
          const row = await send(item);
          failures = 0;
          remove(item.id);
          onStatus(item.id, "sent", row);
        } catch (error) {
          if (error?.status === 409) {
            failures = 0;
            remove(item.id);
            onStatus(item.id, "sent");
            continue;
          }
          if (PERMANENT.has(error?.status)) {
            remove(item.id);
            onStatus(item.id, "failed", undefined, error);
            continue;
          }
          // Network trouble or a server hiccup: wait, then try again.
          const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
          failures += 1;
          for (const queued of queue) onStatus(queued.id, "waiting");
          arm(wait);
          return;
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    /** Add a message and start sending. */
    push(item) {
      queue = [...queue.filter((x) => x.id !== item.id), item];
      persist();
      drain();
    },
    /** Try again straight away (network back, app reopened, user tapped retry). */
    retryNow() {
      failures = 0;
      if (timer) clearTimer(timer);
      timer = null;
      drain();
    },
    /** Messages still waiting to be confirmed (shown after a reload). */
    pending() {
      return [...queue];
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}

/** localStorage-backed storage for one member's outbox. */
export function localOutboxStorage(userId, store = globalThis.localStorage) {
  const key = `dc-outbox-${userId}`;
  return {
    get() {
      try {
        const value = JSON.parse(store?.getItem(key) || "[]");
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    },
    set(items) {
      try {
        if (items.length) store?.setItem(key, JSON.stringify(items));
        else store?.removeItem(key);
      } catch {
        /* storage full or blocked: the message still sends from memory */
      }
    },
  };
}
