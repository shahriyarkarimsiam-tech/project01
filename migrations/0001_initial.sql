PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  game_url TEXT NOT NULL,
  instructions TEXT NOT NULL,
  question1 TEXT NOT NULL,
  question2 TEXT NOT NULL,
  question3 TEXT NOT NULL,
  reward_points REAL NOT NULL CHECK(reward_points >= 0.001 AND reward_points <= 100000),
  capacity INTEGER NOT NULL CHECK(capacity >= 1 AND capacity <= 100000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  answer1 TEXT NOT NULL,
  answer2 TEXT NOT NULL,
  answer3 TEXT NOT NULL,
  device TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  review_note TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_submission_campaign ON submissions(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_submission_user ON submissions(user_id, created_at);

-- SQLite serializes writes; this trigger enforces capacity at insertion time,
-- including submissions awaiting admin verification.
CREATE TRIGGER IF NOT EXISTS enforce_campaign_capacity
BEFORE INSERT ON submissions
WHEN NOT EXISTS (
  SELECT 1 FROM campaigns WHERE id = NEW.campaign_id AND status = 'active'
) OR (
  SELECT COUNT(*) FROM submissions
  WHERE campaign_id = NEW.campaign_id AND status IN ('pending','approved')
) >= (
  SELECT capacity FROM campaigns WHERE id = NEW.campaign_id
)
BEGIN
  SELECT RAISE(ABORT, 'CAMPAIGN_FULL_OR_INACTIVE');
END;

CREATE TABLE IF NOT EXISTS reward_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
  points REAL NOT NULL CHECK(points > 0),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reward_user ON reward_ledger(user_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES users(id),
  referred_user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(inviter_id <> referred_user_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(inviter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount REAL NOT NULL CHECK(amount >= 10),
  wallet_address TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'TRC20',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','rejected')),
  admin_note TEXT,
  processed_by TEXT REFERENCES users(id),
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, created_at);
