// Numbers for the admin dashboard's overview. Counts and totals only: no
// message text, contacts, transaction records or security keys are read.
import { requireAdmin } from "./data.js";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

const startOfDay = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** Buckets timestamps (ms) into `count` periods of `size` ending with the current one. */
export function bucket(times, { now, size, count }) {
  const end = startOfDay(now) + DAY; // end of today (UTC)
  const start = end - size * count;
  const series = Array.from({ length: count }, (_, i) => ({ start: new Date(start + i * size).toISOString(), count: 0 }));
  for (const t of times) {
    if (!Number.isFinite(t) || t < start || t >= end) continue;
    series[Math.floor((t - start) / size)].count += 1;
  }
  return series;
}

export async function adminStats(env, user, now = Date.now()) {
  requireAdmin(user);
  const db = env.DB;
  const sinceWeeks = new Date(startOfDay(now) + DAY - 12 * WEEK).toISOString();
  const [members, signups, messages, active, trialsEnding, sealed, reports, codes, countries] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(status = 'active') AS active,
              SUM(status = 'suspended') AS suspended,
              SUM(role = 'admin') AS admins,
              SUM(role <> 'admin' AND plan = 'Pro') AS pro,
              SUM(role <> 'admin' AND plan <> 'Pro' AND pro_until > ?) AS trial
         FROM users`,
    ).bind(now).first(),
    db.prepare("SELECT created_at FROM users WHERE created_at >= ? AND role <> 'admin'").bind(sinceWeeks).all(),
    db.prepare("SELECT created_at FROM direct_messages WHERE created_at >= ?").bind(startOfDay(now) + DAY - 14 * DAY).all(),
    db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen_at >= ?").bind(now - 7 * DAY).first(),
    db.prepare(
      "SELECT id, display_name, email, pro_until FROM users WHERE role <> 'admin' AND plan <> 'Pro' AND pro_until > ? AND pro_until <= ? AND status = 'active' ORDER BY pro_until ASC LIMIT 8",
    ).bind(now, now + 14 * DAY).all(),
    db.prepare("SELECT COUNT(*) AS total, SUM(opened_at IS NOT NULL) AS opened, SUM(created_at >= ?) AS recent FROM sealed_transfers").bind(now - 30 * DAY).first(),
    db.prepare("SELECT COUNT(*) AS total, SUM(status = 'open') AS open FROM member_reports").first(),
    db.prepare("SELECT SUM(status = 'available') AS available, SUM(status = 'used') AS used FROM pro_access_codes").first(),
    db.prepare("SELECT country, COUNT(*) AS n FROM users WHERE role <> 'admin' GROUP BY country ORDER BY n DESC LIMIT 6").all(),
  ]);
  const num = (value) => Number(value) || 0;
  const total = num(members?.total);
  const admins = num(members?.admins);
  const pro = num(members?.pro);
  const trial = num(members?.trial);
  return {
    generatedAt: new Date(now).toISOString(),
    members: {
      total,
      active: num(members?.active),
      suspended: num(members?.suspended),
      admins: num(members?.admins),
      activeLast7Days: num(active?.n),
    },
    // Plans, sign-ups and trials count members only (administrators excluded).
    plans: { pro, trial, free: Math.max(0, total - admins - pro - trial) },
    signupsByWeek: bucket(
      (signups.results || []).map((r) => Date.parse(r.created_at)),
      { now, size: WEEK, count: 12 },
    ),
    messagesByDay: bucket(
      (messages.results || []).map((r) => Number(r.created_at)),
      { now, size: DAY, count: 14 },
    ),
    trialsEnding: (trialsEnding.results || []).map((r) => ({
      id: r.id,
      name: r.display_name || r.email,
      email: r.email,
      proUntil: new Date(r.pro_until).toISOString(),
    })),
    sealed: { total: num(sealed?.total), opened: num(sealed?.opened), last30Days: num(sealed?.recent) },
    reports: { total: num(reports?.total), open: num(reports?.open) },
    codes: { available: num(codes?.available), used: num(codes?.used) },
    countries: (countries.results || []).map((r) => ({ country: r.country || "Global", members: num(r.n) })),
  };
}
