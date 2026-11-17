// Transaction-record helpers: security keys, IDs, cash claim codes and CSV.
// Pure functions (no React, no storage) so they can be unit-tested.

const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function randomInt(maxExclusive) {
  // Rejection sampling avoids modulo bias.
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer);
  while (buffer[0] >= limit);
  return buffer[0] % maxExclusive;
}

/** Six-digit cash-handoff secret from the platform CSPRNG. */
export function generateSecurityKey() {
  return String(randomInt(1_000_000)).padStart(6, "0");
}

export const isValidSecurityKey = (key) => /^\d{6}$/.test(String(key ?? ""));

/** Transaction ID like TXN-7KQ2-M9XD (32^8 ≈ 10^12 possibilities). */
export function generateTransactionId() {
  let raw = "";
  for (let i = 0; i < 8; i++) raw += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return `TXN-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

const asciiId = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

/**
 * Receiver-bound claim code: DC1-<transfer>-<receiver>-<key>.
 * Names with no Latin letters (for example Ge'ez script) would reduce to an
 * empty receiver part, so a short stable hash of the name is used instead.
 */
export function buildClaimCode(record) {
  const name = String(record.receiver || "").trim();
  let receiverId = asciiId(name).slice(0, 10);
  if (!receiverId && name) {
    let hash = 2166136261;
    for (const char of name.normalize("NFC")) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    receiverId = `U${hash.toString(36).toUpperCase()}`;
  }
  return `DC1-${asciiId(record.id)}-${receiverId || "RECEIVER"}-${record.key}`;
}

// Codes issued before buildClaimCode handled non-Latin names had an empty
// receiver part (DC1-<transfer>--<key>); they stay valid.
const legacyClaimCode = (record) =>
  `DC1-${asciiId(record.id)}-${asciiId(record.receiver || "receiver").slice(0, 10)}-${record.key}`;

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compares a presented claim code with the expected one, ignoring case and outer spaces. */
export function claimCodeMatches(presented, record) {
  if (!isValidSecurityKey(record.key)) return false;
  const given = String(presented ?? "").trim().toUpperCase();
  return sameText(given, buildClaimCode(record)) || sameText(given, legacyClaimCode(record));
}

export const CSV_COLUMNS = [
  ["ID", "id"],
  ["Sender", "sender"],
  ["Sender Phone", "senderPhone"],
  ["From", "from"],
  ["Receiver", "receiver"],
  ["Receiver Phone", "receiverPhone"],
  ["To", "to"],
  ["Account", "account"],
  ["Amount", "amount"],
  ["Currency", "currency"],
  ["Rate", "rate"],
  ["Category", "category"],
  ["Date", "date"],
  ["Status", "status"],
  ["Tag", "tag"],
  ["Security Key", "key"],
  ["Remark", "remark"],
];

// A cell starting with = + - @ (or tab/CR) is run as a formula by Excel and
// Google Sheets. Prefix those with an apostrophe so they stay plain text.
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function recordsToCsv(records) {
  const lines = [
    CSV_COLUMNS.map(([header]) => csvCell(header)).join(","),
    ...records.map((record) => CSV_COLUMNS.map(([, field]) => csvCell(record[field])).join(",")),
  ];
  return `﻿${lines.join("\r\n")}`;
}

/** RFC 4180 parser: quoted fields may contain commas, quotes and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text ?? "").replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

const unescapeCell = (value) => (/^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value);
const toNumber = (value, fallback) => {
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Turns an exported (or hand-made) CSV into records for one owner.
 * Every record gets a valid security key and an ID that is unique among the
 * owner's existing records and the imported rows.
 */
export function importRecordsFromCsv(text, { ownerId, existingIds = [], today }) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { records: [], skipped: 0 };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const index = Object.fromEntries(CSV_COLUMNS.map(([header, field]) => [field, headers.indexOf(header.toLowerCase())]));
  if (index.amount < 0 && index.receiver < 0)
    throw new Error("This file has no Amount or Receiver column. Export a CSV from DataChat to see the expected format.");
  const used = new Set(existingIds);
  const records = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const get = (field) => (index[field] >= 0 ? unescapeCell(row[index[field]] ?? "").trim() : "");
    if (!get("receiver") && !get("amount") && !get("sender")) {
      skipped++;
      continue;
    }
    let id = get("id");
    if (!id || used.has(id)) {
      do id = generateTransactionId();
      while (used.has(id));
    }
    used.add(id);
    const key = get("key");
    records.push({
      id,
      owner: ownerId,
      sender: get("sender"),
      senderPhone: get("senderPhone"),
      from: get("from"),
      receiver: get("receiver"),
      receiverPhone: get("receiverPhone"),
      to: get("to"),
      account: get("account"),
      amount: toNumber(get("amount"), 0),
      currency: get("currency") || "USD",
      rate: toNumber(get("rate"), 1) || 1,
      category: get("category") || "Remittance",
      date: /^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : today,
      status: get("status") || "Draft",
      tag: get("tag"),
      key: isValidSecurityKey(key) ? key : generateSecurityKey(),
      remark: get("remark"),
    });
  }
  return { records, skipped };
}
