/**
 * Uploads the member's synced data without flooding a slow connection.
 *
 * Every change used to PUT the whole data set straight away, so one chat
 * message caused two full uploads, and on a slow link the uploads could
 * finish out of order (an older copy overwriting a newer one). This queue:
 *  - waits a moment and sends only the latest state (coalescing),
 *  - never has more than one upload in flight (so order is preserved),
 *  - skips the upload when nothing synced actually changed,
 *  - retries with backoff after a failure (and when the device comes online).
 */
export function createSyncQueue({
  send,
  delayMs = 800,
  retryMs = [2000, 5000, 15000, 30000],
  onError = () => {},
  onSaved = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let pending = null; // latest rows waiting to go up
  let lastSent = null; // JSON of the rows the server last accepted
  let inFlight = false;
  let timer = null;
  let failures = 0;

  const arm = (ms) => {
    if (timer) clearTimer(timer);
    timer = setTimer(run, ms);
  };

  async function run() {
    timer = null;
    if (inFlight || pending === null) return;
    const rows = pending;
    const body = JSON.stringify(rows);
    pending = null;
    if (body === lastSent) return onSaved(); // the server already has exactly this
    inFlight = true;
    try {
      await send(rows);
      lastSent = body;
      failures = 0;
      onSaved();
    } catch (error) {
      // Keep the newest data: only restore these rows if nothing newer came in.
      if (pending === null) pending = rows;
      const wait = retryMs[Math.min(failures, retryMs.length - 1)];
      failures += 1;
      onError(error, failures);
      inFlight = false;
      arm(wait);
      return;
    }
    inFlight = false;
    if (pending !== null) arm(delayMs);
  }

  return {
    /** Queue the latest full set of rows; the previous unsent set is dropped. */
    schedule(rows) {
      pending = rows;
      if (!inFlight) arm(failures ? retryMs[0] : delayMs);
    },
    /** Send now (e.g. when the app is being hidden or the network returns). */
    flush() {
      if (pending !== null && !inFlight) arm(0);
    },
    /** Mark rows as already on the server (after loading them). */
    markSynced(rows) {
      lastSent = JSON.stringify(rows);
    },
    get busy() {
      return inFlight || pending !== null;
    },
  };
}
