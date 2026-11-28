-- Shared rate offers and communities. Before this, both lived only on the
-- phone that created them and no one else ever saw them.

-- Rate offers posted by members. Visible to everyone only after an
-- administrator approves them; they expire after 30 days.
CREATE TABLE IF NOT EXISTS rate_offers (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  contact        TEXT NOT NULL,
  location       TEXT NOT NULL DEFAULT '',
  side           TEXT NOT NULL CHECK (side IN ('Buy', 'Sell', 'Exchange')),
  from_currency  TEXT NOT NULL,
  to_currency    TEXT NOT NULL,
  rate           REAL NOT NULL CHECK (rate > 0),
  min_amount     REAL NOT NULL DEFAULT 0,
  max_amount     REAL NOT NULL DEFAULT 0,
  instrument     TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  admin_note     TEXT NOT NULL DEFAULT '',
  reviewed_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    INTEGER,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_offers_by_status ON rate_offers(status, expires_at);
CREATE INDEX IF NOT EXISTS rate_offers_by_owner ON rate_offers(owner_id);

-- Communities. Top-level (parent) communities are created by administrators;
-- members create groups beneath one that allows subgroups.
CREATE TABLE IF NOT EXISTS communities (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  location         TEXT NOT NULL DEFAULT '',
  purpose          TEXT NOT NULL DEFAULT '',
  parent_id        TEXT REFERENCES communities(id) ON DELETE CASCADE,
  level            INTEGER NOT NULL DEFAULT 0,
  owner_id         TEXT REFERENCES users(id) ON DELETE SET NULL,  -- NULL: run by administrators
  allow_subgroups  INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS communities_by_parent ON communities(parent_id);

CREATE TABLE IF NOT EXISTS community_members (
  community_id  TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at     INTEGER NOT NULL,
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS community_members_by_user ON community_members(user_id);

CREATE TABLE IF NOT EXISTS community_requests (
  community_id  TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  decided_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (community_id, user_id)
);

-- The two communities the app already showed, now shared for real.
INSERT OR IGNORE INTO communities (id, name, location, purpose, parent_id, level, owner_id, allow_subgroups, status, created_at)
VALUES
  ('community-global', 'DataChat Global Community', 'Global', 'Trusted communication and financial education across regions.', NULL, 0, NULL, 1, 'active', 1784332800000),
  ('community-uae', 'UAE Habesha Network', 'UAE', 'Local support, trusted contacts and community coordination.', 'community-global', 1, NULL, 1, 'active', 1784332800000);
