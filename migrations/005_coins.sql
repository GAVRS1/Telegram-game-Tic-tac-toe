-- migrations/005_coins.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS coins_balance BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS coin_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  reason TEXT NOT NULL,
  event_key TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_created
  ON coin_transactions (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_transactions_event_key_unique
  ON coin_transactions (event_key)
  WHERE event_key IS NOT NULL;
