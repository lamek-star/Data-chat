// Member data on D1: synced records, profiles, direct messages, Pro codes and
// admin actions. Every handler receives the signed-in member (from
// shared/auth.js sessionUser) and only ever touches rows that member may
// see. This replaces Supabase row-level security, so tests/unit/data.test.js
// covers each rule.

import { effectivePlan } from "./auth.js";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_TYPE = /^[A-Za-z]{1,32}$/;
const MAX_SYNC_ROWS = 5000;
const MAX_SYNC_BYTES = 8_000_000;
const SYNC_CHUNK_BYTES = 1_500_000; // stays under D1's 2 MB per bound value
const MAX_MESSAGE_BYTES = 1_500_000; // voice notes travel as data URLs
const MAX_INLINE_PHOTO_BYTES = 300_000;
const MAX_PHOTO_BYTES = 2_000_000;
const now = () => Date.now();

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);

const publicProfile = (row) => ({
  id: row.id,
  display_name: row.display_name,
  username: row.username,
  contact_code: row.contact_code,
  country: row.country,
  avatar_url: row.avatar_url,
});
const PROFILE_COLUMNS = "id, display_name, username, contact_code, country, avatar_url";

const messageRow = (row) => ({
  id: row.id,
  sender_id: row.sender_id,
  recipient_id: row.recipient_id,
  payload: parse(row.payload) ?? {},
  created_at: new Date(row.created_at).toISOString(),
  created_ms: row.created_at,
  read_at: row.read_at ? new Date(row.read_at).toISOString() : null,
});

// ---------------------------------------------------------------- sync --

export async function loadData(env, user) {
  const { results } = await env.DB.prepare(
    "SELECT entity_type, entity_id, payload FROM app_data WHERE user_id = ?",
  ).bind(user.id).all();
  return results.map((row) => ({ entity_type: row.entity_type, entity_id: row.entity_id, payload: parse(row.payload) ?? {} }));
}

/** Replaces all of the member's synced rows in one atomic batch. */
export async function replaceData(env, user, records) {
  if (!Array.isArray(records)) throw new ApiError(400, "Expected a list of records.");
  if (records.length > MAX_SYNC_ROWS) throw new ApiError(413, `Too many items to sync (limit ${MAX_SYNC_ROWS}).`);
  const rows = [];
  const seen = new Set();
  let bytes = 0;
  for (const record of records) {
    const type = String(record?.entity_type ?? "");
    const id = String(record?.entity_id ?? "");
    if (!ENTITY_TYPE.test(type) || !id || id.length > 200) throw new ApiError(400, "Invalid record.");
    const key = `${type}\u0000${id}`;
    if (seen.has(key)) continue; // duplicate keys: keep the first
    seen.add(key);
    const payload = JSON.stringify(record.payload ?? {});
    bytes += payload.length;
    if (bytes > MAX_SYNC_BYTES) throw new ApiError(413, "Too much data to sync at once.");
    rows.push([type, id, payload]);
  }
  // Pack rows into a few JSON chunks: one INSERT per chunk instead of one per row.
  const chunks = [];
  let current = [];
  let size = 0;
  for (const row of rows) {
    const length = row[2].length + row[1].length + 16;
    if (current.length && size + length > SYNC_CHUNK_BYTES) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += length;
  }
  if (current.length) chunks.push(current);
  const stamp = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM app_data WHERE user_id = ?").bind(user.id),
    ...chunks.map((chunk) =>
      env.DB.prepare(
        "INSERT INTO app_data (user_id, entity_type, entity_id, payload, updated_at) " +
          "SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), ? FROM json_each(?)",
      ).bind(user.id, stamp, JSON.stringify(chunk)),
    ),
  ]);
  return { saved: rows.length };
}

// ------------------------------------------------------------ profiles --

export async function findProfiles(env, { ids, code }) {
  if (code) {
    const row = await env.DB.prepare(`SELECT ${PROFILE_COLUMNS} FROM users WHERE contact_code = ?`)
      .bind(clean(code, 32).toUpperCase()).first();
    return row ? [publicProfile(row)] : [];
  }
  const list = [...new Set(String(ids ?? "").split(",").map((x) => x.trim()).filter((x) => UUID.test(x)))].slice(0, 100);
  if (!list.length) return [];
  const { results } = await env.DB.prepare(`SELECT ${PROFILE_COLUMNS} FROM users WHERE id IN (${list.map(() => "?").join(",")})`)
    .bind(...list).all();
  return results.map(publicProfile);
}

export async function updateProfile(env, user, body) {
  const name = body?.name !== undefined ? clean(body.name, 80) : undefined;
  const country = body?.country !== undefined ? clean(body.country, 56) : undefined;
  if (name === "") throw new ApiError(400, "Name cannot be empty.");
  await env.DB.prepare(
    "UPDATE users SET display_name = COALESCE(?, display_name), country = COALESCE(?, country) WHERE id = ?",
  ).bind(name ?? null, country ?? null, user.id).run();
  return env.DB.prepare(`SELECT ${PROFILE_COLUMNS} FROM users WHERE id = ?`).bind(user.id).first().then(publicProfile);
}

/** Stores a profile photo: in R2 (binding FILES) when available, else small images inline. */
export async function saveProfilePhoto(env, user, request) {
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new ApiError(415, "Choose a JPEG, PNG, WebP or GIF image.");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) throw new ApiError(400, "The image is empty.");
  if (bytes.length > MAX_PHOTO_BYTES) throw new ApiError(413, "Choose an image under 2 MB.");
  let url;
  if (env.FILES) {
    await env.FILES.put(`avatars/${user.id}`, bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=3600" } });
    url = `/api/avatars/${user.id}?v=${now()}`;
  } else {
    if (bytes.length > MAX_INLINE_PHOTO_BYTES) throw new ApiError(413, "Choose an image under 300 KB.");
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    url = `data:${type};base64,${btoa(binary)}`;
  }
  await env.DB.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").bind(url, user.id).run();
  return { avatarUrl: url };
}

export async function readAvatar(env, userId) {
  if (!env.FILES || !UUID.test(userId)) return null;
  const object = await env.FILES.get(`avatars/${userId}`);
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ------------------------------------------------------------ messages --

export async function listMessages(env, user, since) {
  const after = Number.isFinite(Number(since)) ? Number(since) : 0;
  const { results } = await env.DB.prepare(
    "SELECT * FROM direct_messages WHERE (sender_id = ?1 OR recipient_id = ?1) AND created_at > ?2 ORDER BY created_at ASC LIMIT 500",
  ).bind(user.id, after).all();
  return results.map(messageRow);
}

export async function sendMessage(env, user, body) {
  const id = String(body?.id ?? "");
  const recipientId = String(body?.recipientId ?? "");
  if (!UUID.test(id)) throw new ApiError(400, "Message id must be a UUID.");
  if (!UUID.test(recipientId)) throw new ApiError(400, "Unknown recipient.");
  if (recipientId === user.id) throw new ApiError(400, "You cannot message yourself.");
  const payload = JSON.stringify(body?.payload ?? {});
  if (payload.length > MAX_MESSAGE_BYTES) throw new ApiError(413, "This message is too large.");
  const recipient = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(recipientId).first();
  if (!recipient) throw new ApiError(404, "Unknown recipient.");
  const created = now();
  try {
    await env.DB.prepare(
      "INSERT INTO direct_messages (id, sender_id, recipient_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, user.id, recipientId, payload, created).run();
  } catch (error) {
    if (/UNIQUE|PRIMARY KEY/i.test(error.message)) throw new ApiError(409, "This message was already sent.");
    throw error;
  }
  return messageRow({ id, sender_id: user.id, recipient_id: recipientId, payload, created_at: created, read_at: null });
}

export async function markRead(env, user, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter((x) => UUID.test(x)).slice(0, 100);
  if (!list.length) return { updated: 0 };
  const result = await env.DB.prepare(
    `UPDATE direct_messages SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL AND id IN (${list.map(() => "?").join(",")})`,
  ).bind(now(), user.id, ...list).run();
  return { updated: result.meta?.changes ?? 0 };
}

// ----------------------------------------------------------- Pro codes --

export async function redeemCode(env, user, rawCode) {
  const code = clean(rawCode, 64).toUpperCase();
  if (!code) throw new ApiError(400, "Enter a code.");
  const used = await env.DB.prepare(
    "UPDATE pro_access_codes SET status = 'used', used_by = ?, used_at = ? WHERE code = ? AND status = 'available'",
  ).bind(user.id, now(), code).run();
  if (!used.meta?.changes) throw new ApiError(404, "Code not found, expired, or already used.");
  await env.DB.prepare("UPDATE users SET plan = 'Pro' WHERE id = ?").bind(user.id).run();
  const row = await env.DB.prepare("SELECT id, code, status FROM pro_access_codes WHERE code = ?").bind(code).first();
  return { id: row.id, code: row.code, plan: "Pro", status: row.status };
}

/** Called by the payment server after Stripe confirms payment. */
export async function grantPro(env, userId) {
  if (!UUID.test(String(userId || ""))) return false;
  const result = await env.DB.prepare("UPDATE users SET plan = 'Pro' WHERE id = ?").bind(userId).run();
  return Boolean(result.meta?.changes);
}

// --------------------------------------------------------------- admin --

function requireAdmin(user) {
  if (user.role !== "admin" || user.status !== "active") throw new ApiError(403, "Administrator access required.");
}

const codeJson = (row) => ({
  id: row.id,
  code: row.code,
  plan: "Pro",
  status: row.status,
  paymentMethod: row.payment_method,
  usedById: row.used_by,
  usedByName: row.used_by_name,
  usedBy: row.used_by_email,
  usedAt: row.used_at ? new Date(row.used_at).toISOString() : null,
  createdAt: new Date(row.created_at).toISOString(),
});

export async function adminListMembers(env, user) {
  requireAdmin(user);
  const { results } = await env.DB.prepare(
    "SELECT id, display_name, username, email, plan, pro_until, role, status, created_at FROM users ORDER BY created_at DESC",
  ).all();
  return results.map((r) => {
    const { plan, trial, proUntil } = effectivePlan(r);
    return { id: r.id, name: r.display_name, username: r.username, email: r.email, plan, trial, proUntil: proUntil ? new Date(proUntil).toISOString() : null, role: r.role, status: r.status, createdAt: r.created_at };
  });
}

export async function adminSetMember(env, user, { userId, plan, status }) {
  requireAdmin(user);
  if (!UUID.test(String(userId || ""))) throw new ApiError(400, "Unknown user.");
  if (plan !== undefined && !["Free", "Pro"].includes(plan)) throw new ApiError(400, "Unknown plan.");
  if (status !== undefined && !["active", "suspended"].includes(status)) throw new ApiError(400, "Unknown status.");
  if (status !== undefined && userId === user.id) throw new ApiError(400, "You cannot change your own status.");
  // Setting Free also ends a running trial, so "Free" really means Free.
  const result = await env.DB.prepare(
    "UPDATE users SET plan = COALESCE(?, plan), status = COALESCE(?, status), pro_until = CASE WHEN ? = 'Free' THEN NULL ELSE pro_until END WHERE id = ?",
  ).bind(plan ?? null, status ?? null, plan ?? null, userId).run();
  if (!result.meta?.changes) throw new ApiError(404, "Unknown user.");
  // A suspended member is signed out everywhere at once.
  if (status === "suspended") await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  return { userId, plan, status };
}

export async function adminListCodes(env, user) {
  requireAdmin(user);
  const { results } = await env.DB.prepare(
    "SELECT c.*, u.display_name AS used_by_name, u.email AS used_by_email FROM pro_access_codes c LEFT JOIN users u ON u.id = c.used_by ORDER BY c.created_at DESC",
  ).all();
  return results.map(codeJson);
}

export async function adminCreateCode(env, user, rawCode) {
  requireAdmin(user);
  const code = clean(rawCode, 64).toUpperCase();
  if (code.length < 12) throw new ApiError(400, "Access codes must contain at least 12 characters.");
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO pro_access_codes (id, code, created_by, created_at) VALUES (?, ?, ?, ?)",
    ).bind(id, code, user.id, now()).run();
  } catch (error) {
    if (/UNIQUE/i.test(error.message)) throw new ApiError(409, "That code already exists.");
    throw error;
  }
  return codeJson(await env.DB.prepare("SELECT *, NULL AS used_by_name, NULL AS used_by_email FROM pro_access_codes WHERE id = ?").bind(id).first());
}
