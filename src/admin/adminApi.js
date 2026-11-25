// Client for the admin dashboard's own host. Same-origin only: the admin
// session is a host-only cookie, so requests never go to another domain.
export class AdminApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError("Can't reach the server. Check your connection.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdminApiError(data.error || `Request failed (${response.status}).`, response.status);
  return data;
}

export const adminApi = {
  session: () => api("/api/auth/session"),
  requestCode: (email) => api("/api/auth/email/start", { method: "POST", body: { email } }),
  verifyCode: (email, code) => api("/api/auth/email/verify", { method: "POST", body: { email, code } }),
  signOut: () => api("/api/auth/logout", { method: "POST", body: {} }),
  stats: async () => (await api("/api/admin/stats")).stats,
  members: async () => (await api("/api/admin/members")).members,
  setPlan: (userId, plan) => api("/api/admin/members", { method: "PATCH", body: { userId, plan } }),
  setStatus: (userId, status) => api("/api/admin/members", { method: "PATCH", body: { userId, status } }),
  codes: async () => (await api("/api/admin/codes")).codes,
  createCode: async (code) => (await api("/api/admin/codes", { method: "POST", body: { code } })).code,
  reports: async (status) => (await api(`/api/admin/reports${status ? `?status=${encodeURIComponent(status)}` : ""}`)).reports,
  reviewReport: (id, status, note = "") => api("/api/admin/reports", { method: "PATCH", body: { id, status, note } }),
  audit: async () => (await api("/api/admin/audit?limit=200")).events,
};
