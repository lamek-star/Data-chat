-- Administrator sessions for the separate admin dashboard
-- (admin.datachat.harmongt.uk). Kept apart from member sessions so a member
-- session can never open the dashboard and an admin session can never be
-- used by the member app. Short-lived: 12 hours at most, 30 minutes idle.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash    TEXT PRIMARY KEY,                       -- SHA-256 of the cookie value
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  ip            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS admin_sessions_by_user ON admin_sessions(user_id);
