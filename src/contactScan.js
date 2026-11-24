/**
 * Reads whatever a customer scans or pastes to add a contact:
 *  - the contact link in a member's QR (https://<app>/?add=CODE), which any
 *    phone camera can open,
 *  - the older JSON QR ({type: "datachat-user-contact", userId, contactCode}),
 *  - a bare contact code, typed with any spacing, dashes or case.
 * Returns { userId?, contactCode? } or { kind } explaining what it was instead.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contact codes are 6–32 letters/digits; ignore spaces, dashes and case. */
export function normalizeContactCode(value) {
  const code = String(value ?? "").replace(/[\s-]+/g, "").toUpperCase();
  return /^[A-Z0-9]{6,32}$/.test(code) ? code : "";
}

export function contactLink(appUrl, contactCode) {
  const url = new URL(appUrl);
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("add", contactCode);
  return url.toString();
}

export function parseContactScan(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { kind: "empty" };

  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      return { kind: "unknown" };
    }
    if (url.searchParams.has("seal")) return { kind: "seal", value: url.searchParams.get("seal") };
    const code = normalizeContactCode(url.searchParams.get("add"));
    return code ? { contactCode: code } : { kind: "unknown" };
  }

  if (text.startsWith("{")) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { kind: "unknown" };
    }
    if (data?.type === "datachat-user-contact") {
      const userId = UUID.test(String(data.userId ?? "")) ? data.userId : undefined;
      const contactCode = normalizeContactCode(data.contactCode) || undefined;
      return userId || contactCode ? { userId, contactCode } : { kind: "unknown" };
    }
    if (data?.type === "datachat-transaction-record") return { kind: "transaction" };
    if (data?.type === "datachat-contact") return { kind: "saved-contact" };
    return { kind: "unknown" };
  }

  if (/^DCS1:/i.test(text)) return { kind: "seal", value: text };
  const code = normalizeContactCode(text);
  return code ? { contactCode: code } : { kind: "unknown" };
}

/** A clear sentence for each thing that isn't a member's contact QR. */
export function scanProblem(kind) {
  switch (kind) {
    case "transaction":
      return "That is a transaction QR, not a contact. Open it from Transactions instead.";
    case "seal":
      return "That is a locked transfer. Open it from Transactions › Open locked transfer.";
    case "saved-contact":
      return "That QR is a saved contact card, not a DataChat member. Ask them to show their own QR (Messages › QR icon).";
    case "empty":
      return "No QR code was found. Hold the code inside the frame, or type their contact code.";
    default:
      return "This is not a DataChat contact QR. Ask them to open Messages and tap the QR icon.";
  }
}
