-- DataChat on D1, part 3: 3-month Pro trial, passkeys (fingerprint / face
-- unlock) and sealed transfers that only the receiver can open.

-- Pro trial: until this time (unix ms) the member has Pro even on the Free
-- plan. Paid, cash-code and admin-granted Pro (plan = 'Pro') never expire.
ALTER TABLE users ADD COLUMN pro_until INTEGER;

-- Existing Free members get the same 90-day trial as new ones.
UPDATE users
SET pro_until = CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 90 * 24 * 60 * 60 * 1000
WHERE plan = 'Free' AND pro_until IS NULL;

-- One row per registered passkey (WebAuthn credential).
CREATE TABLE IF NOT EXISTS passkeys (
  credential_id  TEXT PRIMARY KEY,                    -- base64url
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key     TEXT NOT NULL,                       -- base64url COSE key
  counter        INTEGER NOT NULL DEFAULT 0,
  transports     TEXT NOT NULL DEFAULT '[]',          -- JSON array
  device_name    TEXT NOT NULL DEFAULT 'This device',
  created_at     INTEGER NOT NULL,
  last_used_at   INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_by_user ON passkeys(user_id);

-- Single-use WebAuthn challenges (5 minutes).
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('register', 'open-seal')),
  challenge   TEXT NOT NULL,
  seal_id     TEXT,
  expires_at  INTEGER NOT NULL
);

-- Transfer details locked to one receiver. The QR code carries only the id
-- and a random token; the details are released after the receiver passes a
-- passkey (biometric) check on the server.
CREATE TABLE IF NOT EXISTS sealed_transfers (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL,                        -- SHA-256 of the QR token
  sender_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  details       TEXT NOT NULL,                        -- JSON
  created_at    INTEGER NOT NULL,
  opened_at     INTEGER,
  CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS sealed_by_recipient ON sealed_transfers(recipient_id, created_at);
CREATE INDEX IF NOT EXISTS sealed_by_sender ON sealed_transfers(sender_id, created_at);
