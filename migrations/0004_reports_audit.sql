-- DataChat on D1, part 4: member safety reports that admins can review, and
-- a log of every admin action. Both are written only by the Worker
-- (shared/safety.js, shared/audit.js).

CREATE TABLE IF NOT EXISTS member_reports (
  id            TEXT PRIMARY KEY,
  reporter_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        TEXT NOT NULL,
  details       TEXT NOT NULL DEFAULT '',
  evidence      TEXT NOT NULL DEFAULT '[]',            -- JSON: messages copied by the server, never by the app
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  admin_note    TEXT NOT NULL DEFAULT '',
  reviewed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   INTEGER,
  created_at    INTEGER NOT NULL,
  CHECK (reporter_id <> reported_id)
);
CREATE INDEX IF NOT EXISTS member_reports_by_status ON member_reports(status, created_at);
CREATE INDEX IF NOT EXISTS member_reports_by_reporter ON member_reports(reporter_id, created_at);

CREATE TABLE IF NOT EXISTS admin_audit (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  admin_email TEXT NOT NULL,                           -- kept so the log survives the admin's account
  action      TEXT NOT NULL,
  target_id   TEXT,
  detail      TEXT NOT NULL DEFAULT '{}',              -- JSON
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_audit_by_time ON admin_audit(created_at);
