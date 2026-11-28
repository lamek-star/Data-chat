// Shared rate offers and communities (migrations/0006).
//
// Rate offers: a member posts an offer -> it waits for an administrator ->
// once approved every member sees it for 30 days. The owner can withdraw it.
//
// Communities: administrators create the top-level communities (anyone can
// join those straight away). Members create groups beneath a community that
// allows subgroups; joining a member's group needs the owner's approval.
import { ApiError, requireAdmin } from "./data.js";
import { recordAudit } from "./audit.js";

const DAY = 24 * 60 * 60 * 1000;
export const OFFER_TTL_MS = 30 * DAY;
const MAX_PENDING_OFFERS = 5;
const MAX_OWNED_GROUPS = 10;
const MAX_LEVEL = 4;
const SIDES = ["Buy", "Sell", "Exchange"];
const CURRENCY = /^[A-Z0-9]{2,6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9_-]{6,64}$/;

/** Trimmed, control-character-free text with a length check. */
function text(value, { max, min = 0, label }) {
  const clean = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length < min) throw new ApiError(400, min > 1 ? `${label} needs at least ${min} characters.` : `${label} is required.`);
  if (clean.length > max) throw new ApiError(400, `${label} can be at most ${max} characters.`);
  return clean;
}
function amount(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new ApiError(400, `${label} must be a positive number.`);
  return n;
}
const currency = (value, label) => {
  const code = String(value ?? "").trim().toUpperCase();
  if (!CURRENCY.test(code)) throw new ApiError(400, `${label} must be a currency code like USD or ETB.`);
  return code;
};

// ---------------------------------------------------------------- offers --

function offerRow(r, viewer) {
  const mine = viewer && r.owner_id === viewer.id;
  return {
    id: r.id,
    ownerId: r.owner_id,
    provider: r.provider,
    contact: r.contact,
    location: r.location,
    side: r.side,
    fromCurrency: r.from_currency,
    toCurrency: r.to_currency,
    rate: r.rate,
    min: r.min_amount,
    max: r.max_amount,
    instrument: r.instrument,
    note: r.note,
    status: r.status,
    verified: r.status === "approved",
    mine: Boolean(mine),
    ...(mine || viewer?.role === "admin" ? { adminNote: r.admin_note } : {}),
    createdAt: new Date(r.created_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
  };
}

/** Approved, unexpired offers from active members, plus the viewer's own. */
export async function listOffers(env, user, now = Date.now()) {
  const { results } = await env.DB.prepare(
    `SELECT o.* FROM rate_offers o JOIN users u ON u.id = o.owner_id
      WHERE (o.status = 'approved' AND o.expires_at > ?1 AND u.status = 'active')
         OR (o.owner_id = ?2 AND o.status <> 'withdrawn')
      ORDER BY (o.owner_id = ?2) DESC, o.created_at DESC LIMIT 200`,
  ).bind(now, user.id).all();
  return results.map((r) => offerRow(r, user));
}

export async function createOffer(env, user, body = {}, now = Date.now()) {
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_offers WHERE owner_id = ? AND status = 'pending'").bind(user.id).first();
  if (Number(pending?.n) >= MAX_PENDING_OFFERS)
    throw new ApiError(429, `You already have ${MAX_PENDING_OFFERS} offers waiting for approval. Wait for a decision first.`);
  if (!SIDES.includes(body.side)) throw new ApiError(400, "Choose Buy, Sell or Exchange.");
  const rate = Number(body.rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1e9) throw new ApiError(400, "Enter a rate above zero.");
  const min = amount(body.min, "Minimum amount");
  const max = amount(body.max, "Maximum amount");
  if (max < min) throw new ApiError(400, "The maximum amount must be at least the minimum.");
  const from = currency(body.fromCurrency, "From currency");
  const to = currency(body.toCurrency, "To currency");
  if (from === to) throw new ApiError(400, "Choose two different currencies.");
  const row = {
    id: crypto.randomUUID(),
    owner_id: user.id,
    provider: text(body.provider, { max: 60, min: 2, label: "Provider name" }),
    contact: text(body.contact, { max: 80, min: 3, label: "Contact information" }),
    location: text(body.location, { max: 80, min: 2, label: "Location" }),
    side: body.side,
    from_currency: from,
    to_currency: to,
    rate,
    min_amount: min,
    max_amount: max,
    instrument: text(body.instrument, { max: 40, min: 2, label: "Financial instrument" }),
    note: text(body.note, { max: 500, label: "Terms and notes" }),
    status: "pending",
    admin_note: "",
    created_at: now,
    expires_at: now + OFFER_TTL_MS,
  };
  await env.DB.prepare(
    `INSERT INTO rate_offers (id, owner_id, provider, contact, location, side, from_currency, to_currency, rate, min_amount, max_amount, instrument, note, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(row.id, row.owner_id, row.provider, row.contact, row.location, row.side, row.from_currency, row.to_currency, row.rate, row.min_amount, row.max_amount, row.instrument, row.note, row.created_at, row.expires_at).run();
  return offerRow(row, user);
}

export async function withdrawOffer(env, user, { id } = {}) {
  if (!UUID.test(String(id || ""))) throw new ApiError(400, "Unknown offer.");
  const result = await env.DB.prepare("UPDATE rate_offers SET status = 'withdrawn' WHERE id = ? AND owner_id = ? AND status <> 'withdrawn'").bind(id, user.id).run();
  if (!result.meta?.changes) throw new ApiError(404, "Offer not found.");
  return { withdrawn: true };
}

export async function adminListOffers(env, user, status, now = Date.now()) {
  requireAdmin(user);
  const filter = ["pending", "approved", "rejected", "withdrawn"].includes(status) ? status : null;
  const { results } = await env.DB.prepare(
    `SELECT o.*, u.display_name AS owner_name, u.email AS owner_email FROM rate_offers o JOIN users u ON u.id = o.owner_id
      WHERE (?1 IS NULL OR o.status = ?1) ORDER BY (o.status = 'pending') DESC, o.created_at DESC LIMIT 300`,
  ).bind(filter).all();
  return results.map((r) => ({ ...offerRow(r, user), ownerName: r.owner_name, ownerEmail: r.owner_email, expired: r.expires_at <= now }));
}

export async function adminReviewOffer(env, user, { id, status, note } = {}, now = Date.now()) {
  requireAdmin(user);
  if (!UUID.test(String(id || ""))) throw new ApiError(400, "Unknown offer.");
  if (!["approved", "rejected"].includes(status)) throw new ApiError(400, "Choose approve or reject.");
  const adminNote = text(note, { max: 300, label: "Note" });
  // Approving starts the 30 days from now, so an offer isn't half-expired when it goes live.
  const result = await env.DB.prepare(
    "UPDATE rate_offers SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = ?, expires_at = CASE WHEN ? = 'approved' THEN ? ELSE expires_at END WHERE id = ? AND status <> 'withdrawn'",
  ).bind(status, adminNote, user.id, now, status, now + OFFER_TTL_MS, id).run();
  if (!result.meta?.changes) throw new ApiError(404, "Offer not found.");
  await recordAudit(env, user, "offer.review", id, { status, ...(adminNote ? { note: adminNote } : {}) });
  return { id, status };
}

// ----------------------------------------------------------- communities --

const communityRow = (r) => ({
  id: r.id,
  name: r.name,
  location: r.location,
  purpose: r.purpose,
  parentId: r.parent_id,
  level: r.level,
  ownerId: r.owner_id,
  ownerName: r.owner_name || null,
  adminRun: !r.owner_id,
  allowSubgroups: Boolean(r.allow_subgroups),
  status: r.status,
  memberCount: Number(r.member_count) || 0,
  createdAt: new Date(r.created_at).toISOString(),
});

const COMMUNITY_SELECT = `SELECT c.*, owner.display_name AS owner_name,
    (SELECT COUNT(*) FROM community_members m WHERE m.community_id = c.id) AS member_count
  FROM communities c LEFT JOIN users owner ON owner.id = c.owner_id`;

/** Active communities with the viewer's membership, request and (for owners) waiting requests. */
export async function listCommunities(env, user) {
  const [{ results: rows }, { results: mine }, { results: requests }] = await Promise.all([
    env.DB.prepare(`${COMMUNITY_SELECT} WHERE c.status = 'active' ORDER BY c.level ASC, c.created_at ASC LIMIT 500`).all(),
    env.DB.prepare("SELECT community_id, role FROM community_members WHERE user_id = ?").bind(user.id).all(),
    env.DB.prepare(
      `SELECT r.community_id, r.user_id, r.status, r.created_at, u.display_name, u.username
         FROM community_requests r JOIN users u ON u.id = r.user_id
         LEFT JOIN communities c ON c.id = r.community_id
        WHERE r.user_id = ?1 OR (c.owner_id = ?1 AND r.status = 'pending')`,
    ).bind(user.id).all(),
  ]);
  const roles = new Map(mine.map((m) => [m.community_id, m.role]));
  return rows.map((r) => {
    const c = communityRow(r);
    const myRequest = requests.find((q) => q.community_id === c.id && q.user_id === user.id);
    const isOwner = c.ownerId === user.id;
    return {
      ...c,
      myRole: roles.get(c.id) || null,
      myRequest: myRequest && !roles.has(c.id) ? myRequest.status : null,
      canManage: isOwner,
      pendingRequests: isOwner
        ? requests
            .filter((q) => q.community_id === c.id && q.status === "pending")
            .map((q) => ({ userId: q.user_id, name: q.display_name, username: q.username, requestedAt: new Date(q.created_at).toISOString() }))
        : [],
    };
  });
}

async function activeCommunity(env, id) {
  if (!ID.test(String(id || ""))) throw new ApiError(400, "Unknown community.");
  const row = await env.DB.prepare("SELECT * FROM communities WHERE id = ? AND status = 'active'").bind(id).first();
  if (!row) throw new ApiError(404, "Community not found.");
  return row;
}

function communityFields(body) {
  return {
    name: text(body.name, { max: 60, min: 3, label: "Community name" }),
    location: text(body.location, { max: 80, min: 2, label: "Location" }),
    purpose: text(body.purpose, { max: 400, min: 12, label: "Purpose" }),
    allowSubgroups: body.allowSubgroups === true || body.allowSubgroups === "on",
  };
}

export async function createCommunity(env, user, body = {}, now = Date.now()) {
  const parent = await activeCommunity(env, body.parentId);
  if (!parent.allow_subgroups) throw new ApiError(400, "This community doesn't allow groups beneath it.");
  if (parent.level + 1 > MAX_LEVEL) throw new ApiError(400, "Groups can't be nested any deeper.");
  const owned = await env.DB.prepare("SELECT COUNT(*) AS n FROM communities WHERE owner_id = ? AND status = 'active'").bind(user.id).first();
  if (Number(owned?.n) >= MAX_OWNED_GROUPS) throw new ApiError(429, `You can run up to ${MAX_OWNED_GROUPS} groups.`);
  const f = communityFields(body);
  const id = `community-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO communities (id, name, location, purpose, parent_id, level, owner_id, allow_subgroups, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)",
    ).bind(id, f.name, f.location, f.purpose, parent.id, parent.level + 1, user.id, f.allowSubgroups ? 1 : 0, now),
    env.DB.prepare("INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, now),
  ]);
  return { id };
}

/** Admin-run communities: join at once. Member groups: ask the owner. */
export async function joinCommunity(env, user, { id } = {}, now = Date.now()) {
  const community = await activeCommunity(env, id);
  const member = await env.DB.prepare("SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ?").bind(id, user.id).first();
  if (member) return { status: "member" };
  if (!community.owner_id) {
    await env.DB.prepare("INSERT OR IGNORE INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(id, user.id, now).run();
    return { status: "member" };
  }
  await env.DB.prepare(
    `INSERT INTO community_requests (community_id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)
     ON CONFLICT(community_id, user_id) DO UPDATE SET status = 'pending', created_at = excluded.created_at, decided_at = NULL, decided_by = NULL`,
  ).bind(id, user.id, now).run();
  return { status: "pending" };
}

export async function decideJoinRequest(env, user, { id, userId, approve } = {}, now = Date.now()) {
  const community = await activeCommunity(env, id);
  if (community.owner_id !== user.id) throw new ApiError(403, "Only the group's owner can answer join requests.");
  if (!UUID.test(String(userId || ""))) throw new ApiError(400, "Unknown member.");
  const decision = approve === true ? "approved" : "declined";
  const result = await env.DB.prepare(
    "UPDATE community_requests SET status = ?, decided_at = ?, decided_by = ? WHERE community_id = ? AND user_id = ? AND status = 'pending'",
  ).bind(decision, now, user.id, id, userId).run();
  if (!result.meta?.changes) throw new ApiError(404, "This request was already answered or withdrawn.");
  if (decision === "approved")
    await env.DB.prepare("INSERT OR IGNORE INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(id, userId, now).run();
  return { status: decision };
}

export async function leaveCommunity(env, user, { id } = {}) {
  const community = await activeCommunity(env, id);
  if (community.owner_id === user.id) throw new ApiError(400, "You own this group. Ask an administrator to archive it instead.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM community_members WHERE community_id = ? AND user_id = ?").bind(id, user.id),
    env.DB.prepare("DELETE FROM community_requests WHERE community_id = ? AND user_id = ?").bind(id, user.id),
  ]);
  return { left: true };
}

export async function adminListCommunities(env, user) {
  requireAdmin(user);
  const { results } = await env.DB.prepare(`${COMMUNITY_SELECT} ORDER BY c.status ASC, c.level ASC, c.created_at ASC LIMIT 1000`).all();
  return results.map(communityRow);
}

export async function adminCreateCommunity(env, user, body = {}, now = Date.now()) {
  requireAdmin(user);
  let parent = null;
  if (body.parentId) {
    parent = await activeCommunity(env, body.parentId);
    if (parent.level + 1 > MAX_LEVEL) throw new ApiError(400, "Communities can't be nested any deeper.");
  }
  const f = communityFields(body);
  const id = `community-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO communities (id, name, location, purpose, parent_id, level, owner_id, allow_subgroups, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'active', ?)",
  ).bind(id, f.name, f.location, f.purpose, parent?.id ?? null, parent ? parent.level + 1 : 0, f.allowSubgroups ? 1 : 0, now).run();
  await recordAudit(env, user, "community.create", id, { name: f.name });
  return { id };
}

export async function adminSetCommunity(env, user, { id, status } = {}) {
  requireAdmin(user);
  if (!ID.test(String(id || ""))) throw new ApiError(400, "Unknown community.");
  if (!["active", "archived"].includes(status)) throw new ApiError(400, "Choose active or archived.");
  const result = await env.DB.prepare("UPDATE communities SET status = ? WHERE id = ?").bind(status, id).run();
  if (!result.meta?.changes) throw new ApiError(404, "Community not found.");
  await recordAudit(env, user, "community.status", id, { status });
  return { id, status };
}
