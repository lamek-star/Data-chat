// A member's own account: download everything DataChat holds about them, or
// delete the account. Deletion removes the user row; every other table
// cascades from it (migrations 0001-0004).

import { publicUser } from "./auth.js";
import { ApiError } from "./data.js";

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

export async function exportAccount(env, user) {
  const db = env.DB;
  const [profile, data, messages, passkeys, seals, reports] = await Promise.all([
    db.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first(),
    db.prepare("SELECT entity_type, entity_id, payload, updated_at FROM app_data WHERE user_id = ?").bind(user.id).all(),
    db.prepare("SELECT * FROM direct_messages WHERE sender_id = ? OR recipient_id = ? ORDER BY created_at").bind(user.id, user.id).all(),
    db.prepare("SELECT credential_id, device_name, created_at, last_used_at FROM passkeys WHERE user_id = ?").bind(user.id).all(),
    db.prepare("SELECT * FROM sealed_transfers WHERE sender_id = ? OR recipient_id = ? ORDER BY created_at").bind(user.id, user.id).all(),
    db.prepare("SELECT id, reported_id, reason, details, status, created_at FROM member_reports WHERE reporter_id = ?").bind(user.id).all(),
  ]);
  return {
    format: "datachat-account-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    account: { ...publicUser(profile), phone: profile.phone },
    records: data.results.map((r) => ({ type: r.entity_type, id: r.entity_id, updatedAt: iso(r.updated_at), payload: parse(r.payload) })),
    messages: messages.results.map((m) => ({
      id: m.id,
      direction: m.sender_id === user.id ? "sent" : "received",
      otherMemberId: m.sender_id === user.id ? m.recipient_id : m.sender_id,
      at: iso(m.created_at),
      readAt: iso(m.read_at),
      payload: parse(m.payload),
    })),
    passkeys: passkeys.results.map((p) => ({ id: p.credential_id, device: p.device_name, createdAt: iso(p.created_at), lastUsedAt: iso(p.last_used_at) })),
    // A locked transfer the member hasn't opened yet stays locked: its
    // details still need their fingerprint, so only the fact of it is listed.
    lockedTransfers: seals.results.map((s) => {
      const sent = s.sender_id === user.id;
      return {
        id: s.id,
        direction: sent ? "sent" : "received",
        otherMemberId: sent ? s.recipient_id : s.sender_id,
        createdAt: iso(s.created_at),
        openedAt: iso(s.opened_at),
        details: sent || s.opened_at ? parse(s.details) : "locked until you open it with your fingerprint",
      };
    }),
    reportsFiled: reports.results.map((r) => ({ id: r.id, reportedMemberId: r.reported_id, reason: r.reason, details: r.details, status: r.status, createdAt: iso(r.created_at) })),
  };
}

/** Deletes the account for good. The member must type their own email. */
export async function deleteAccount(env, user, body) {
  if (String(body?.confirmEmail ?? "").trim().toLowerCase() !== String(user.email).toLowerCase())
    throw new ApiError(400, "Type your email address exactly to confirm.");
  if (user.role === "admin") {
    const { admins } = await env.DB.prepare(
      "SELECT COUNT(*) AS admins FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?",
    ).bind(user.id).first();
    if (!admins) throw new ApiError(409, "You are the only administrator. Make someone else admin before deleting this account.");
  }
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  return { deleted: true };
}
