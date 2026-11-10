-- Migration 0003: Update currency from integer points to USDT with decimal support
DROP TRIGGER IF EXISTS enforce_campaign_capacity;

CREATE TABLE campaigns_new (
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
INSERT INTO campaigns_new SELECT * FROM campaigns;
DROP TABLE campaigns;
ALTER TABLE campaigns_new RENAME TO campaigns;

CREATE TRIGGER enforce_campaign_capacity
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

CREATE TABLE reward_ledger_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
  points REAL NOT NULL CHECK(points > 0),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO reward_ledger_new SELECT * FROM reward_ledger;
DROP TABLE reward_ledger;
ALTER TABLE reward_ledger_new RENAME TO reward_ledger;
CREATE INDEX IF NOT EXISTS idx_reward_user ON reward_ledger(user_id, created_at);
