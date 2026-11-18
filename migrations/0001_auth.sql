-- DataChat on Cloudflare D1: accounts, email login codes and sessions.
-- Apply with: npx wrangler d1 migrations apply datachat --remote
--
-- Only the Worker reads or writes these tables. Plan, role and status live
-- on the account row and are changed only by server code (Stripe webhook,
-- cash-code redemption, admin endpoints), never from the browser.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                       -- UUID
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username      TEXT UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL DEFAULT 'DataChat member',
  phone         TEXT NOT NULL DEFAULT '',               -- private: never shown to other members
  country       TEXT NOT NULL DEFAULT 'Global',
  contact_code  TEXT NOT NULL UNIQUE,                   -- shareable code other members use to add you
  plan          TEXT NOT NULL DEFAULT 'Free'   CHECK (plan IN ('Free', 'Pro')),
  role          TEXT NOT NULL DEFAULT 'user'   CHECK (role IN ('user', 'admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One pending code per email. Only an HMAC of the code is stored.
CREATE TABLE IF NOT EXISTS login_codes (
  email       TEXT PRIMARY KEY COLLATE NOCASE,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,                         -- unix milliseconds
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- Only a SHA-256 of the session token is stored, so a database leak does
-- not hand out working sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);

-- Fixed-window counters for login rate limits.
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL
);
