-- migrations/003_referrals.sql
CREATE TABLE IF NOT EXISTS referrals (
  inviter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inviter_id, invited_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_invited_unique ON referrals (invited_id);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals (inviter_id);
