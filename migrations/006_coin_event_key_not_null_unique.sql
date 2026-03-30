UPDATE coin_transactions
SET event_key = CONCAT('legacy:', id::text)
WHERE event_key IS NULL OR BTRIM(event_key) = '';

DROP INDEX IF EXISTS idx_coin_transactions_event_key_unique;

ALTER TABLE coin_transactions
  ALTER COLUMN event_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_transactions_event_key_unique
  ON coin_transactions (event_key);
