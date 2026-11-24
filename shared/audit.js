// Log of admin actions (migrations/0004). Every admin write records who did
// what to whom, so changes to members, codes and reports can be reviewed.

export async function recordAudit(env, admin, action, targetId = null, detail = {}) {
  await env.DB.prepare(
    "INSERT INTO admin_audit (id, admin_id, admin_email, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), admin.id, admin.email, action, targetId, JSON.stringify(detail), Date.now()).run();
}

export async function listAudit(env, limit = 200) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT ?",
  ).bind(Math.min(Math.max(Number(limit) || 200, 1), 500)).all();
  return results.map((r) => {
    let detail = {};
    try {
      detail = JSON.parse(r.detail);
    } catch {
      /* keep {} */
    }
    return { id: r.id, adminId: r.admin_id, adminEmail: r.admin_email, action: r.action, targetId: r.target_id, detail, createdAt: new Date(r.created_at).toISOString() };
  });
}
