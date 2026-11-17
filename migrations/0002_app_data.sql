-- DataChat on D1, part 2: each member's synced data, direct messages and
-- Pro access codes. Replaces the Supabase tables of the same purpose.
-- Every read and write goes through the Worker, which checks the signed-in
-- member (shared/data.js); there is no direct client access to D1.

ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- One member's records, contacts, notifications etc. (JSON payloads).
CREATE TABLE IF NOT EXISTS app_data (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  payload      TEXT NOT NULL,                         -- JSON
  updated_at   INTEGER NOT NULL,                      -- unix milliseconds
  PRIMARY KEY (user_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id            TEXT PRIMARY KEY,                     -- UUID chosen by the sender's app
  sender_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload       TEXT NOT NULL,                        -- JSON
  created_at    INTEGER NOT NULL,                     -- unix milliseconds
  read_at       INTEGER,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS direct_messages_by_recipient ON direct_messages(recipient_id, created_at);
CREATE INDEX IF NOT EXISTS direct_messages_by_sender ON direct_messages(sender_id, created_at);

CREATE TABLE IF NOT EXISTS pro_access_codes (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'used', 'revoked')),
  payment_method  TEXT NOT NULL DEFAULT 'Cash',
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_at         INTEGER,
  created_at      INTEGER NOT NULL
);
