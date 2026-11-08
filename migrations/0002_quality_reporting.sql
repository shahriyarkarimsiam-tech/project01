-- Version 0.2: audit-friendly quality controls and tester dispute workflow.
-- No monetary accounts or withdrawable balances are created here.
CREATE TABLE IF NOT EXISTS task_launches (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_launched_at TEXT NOT NULL DEFAULT (datetime('now')),
  launch_count INTEGER NOT NULL DEFAULT 1 CHECK(launch_count BETWEEN 1 AND 100),
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_launches_user ON task_launches(user_id);

ALTER TABLE submissions ADD COLUMN risk_flags TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 20 AND 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered')),
  admin_reply TEXT,
  responded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status,created_at);
