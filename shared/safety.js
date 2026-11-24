// Member safety reports (migrations/0004). A member reports someone they have
// talked to; admins review the report in the portal. Message evidence is
// copied by the server from direct_messages, so a report can't carry
// invented messages.

import { recordAudit } from "./audit.js";
import { ApiError, requireAdmin } from "./data.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = ["Scam or fraud attempt", "Harassment or threats", "False identity", "Suspicious transaction request", "Spam", "Other safety concern"];
const MAX_REPORTS_PER_DAY = 20;
const EVIDENCE_MESSAGES = 10;
const EVIDENCE_TEXT = 1000; // characters kept per message; voice notes are left out
const DAY = 24 * 60 * 60 * 1000;

const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
const parse = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

export const REPORT_REASONS = REASONS;

// The last few messages between the two members, text only.
async function evidenceFor(env, a, b) {
  const { results } = await env.DB.prepare(
    `SELECT sender_id, payload, created_at FROM direct_messages
     WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
     ORDER BY created_at DESC LIMIT ?`,
  ).bind(a, b, b, a, EVIDENCE_MESSAGES).all();
  return results.reverse().map((row) => {
    const payload = parse(row.payload, {});
    const text = payload.voiceUrl ? "[voice note]" : typeof payload.content === "string" ? payload.content : "[attachment]";
    return { senderId: row.sender_id, text: text.slice(0, EVIDENCE_TEXT), at: new Date(row.created_at).toISOString() };
  });
}

export async function createReport(env, user, body) {
  const reportedId = String(body?.reportedId ?? "");
  if (!UUID.test(reportedId)) throw new ApiError(400, "Choose the member you want to report.");
  if (reportedId === user.id) throw new ApiError(400, "You cannot report yourself.");
  const reason = REASONS.includes(body?.reason) ? body.reason : null;
  if (!reason) throw new ApiError(400, "Choose a reason for the report.");
  const details = clean(body?.details, 2000);

  const reported = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(reportedId).first();
  if (!reported) throw new ApiError(404, "That member no longer exists.");

  const { recent } = await env.DB.prepare(
    "SELECT COUNT(*) AS recent FROM member_reports WHERE reporter_id = ? AND created_at > ?",
  ).bind(user.id, Date.now() - DAY).first();
  if (recent >= MAX_REPORTS_PER_DAY) throw new ApiError(429, "You have sent many reports today. Try again tomorrow.");

  const evidence = body?.includeMessages ? await evidenceFor(env, user.id, reportedId) : [];
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await env.DB.prepare(
    "INSERT INTO member_reports (id, reporter_id, reported_id, reason, details, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, user.id, reportedId, reason, details, JSON.stringify(evidence), createdAt).run();
  return { id, status: "open", reason, evidenceCount: evidence.length, createdAt: new Date(createdAt).toISOString() };
}

/** The member's own reports, without the evidence or admin notes. */
export async function listMyReports(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.reason, r.status, r.created_at, u.display_name AS reported_name
     FROM member_reports r JOIN users u ON u.id = r.reported_id
     WHERE r.reporter_id = ? ORDER BY r.created_at DESC LIMIT 100`,
  ).bind(user.id).all();
  return results.map((r) => ({ id: r.id, reason: r.reason, status: r.status, reportedName: r.reported_name, createdAt: new Date(r.created_at).toISOString() }));
}

export async function adminListReports(env, user, status) {
  requireAdmin(user);
  const filter = ["open", "actioned", "dismissed"].includes(status) ? status : null;
  const { results } = await env.DB.prepare(
    `SELECT r.*, a.display_name AS reporter_name, a.email AS reporter_email,
            b.display_name AS reported_name, b.email AS reported_email, b.status AS reported_status
     FROM member_reports r
     JOIN users a ON a.id = r.reporter_id
     JOIN users b ON b.id = r.reported_id
     WHERE (? IS NULL OR r.status = ?)
     ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 300`,
  ).bind(filter, filter).all();
  return results.map((r) => ({
    id: r.id,
    reason: r.reason,
    details: r.details,
    evidence: parse(r.evidence, []),
    status: r.status,
    adminNote: r.admin_note,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    reporter: { id: r.reporter_id, name: r.reporter_name, email: r.reporter_email },
    reported: { id: r.reported_id, name: r.reported_name, email: r.reported_email, status: r.reported_status },
  }));
}

export async function adminReviewReport(env, user, body) {
  requireAdmin(user);
  const id = String(body?.id ?? "");
  if (!UUID.test(id)) throw new ApiError(400, "Unknown report.");
  if (!["open", "actioned", "dismissed"].includes(body?.status)) throw new ApiError(400, "Unknown report status.");
  const note = clean(body?.note, 1000);
  const result = await env.DB.prepare(
    "UPDATE member_reports SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
  ).bind(body.status, note, user.id, Date.now(), id).run();
  if (!result.meta?.changes) throw new ApiError(404, "Unknown report.");
  await recordAudit(env, user, "report.review", id, { status: body.status, note });
  return { id, status: body.status, adminNote: note };
}
