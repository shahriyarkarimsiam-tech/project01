-- Migration 0004: Referrals tracking and USDT withdrawals
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
