-- migrations/004_users_ref_code.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ref_code TEXT;

UPDATE users
SET ref_code = 'U' || UPPER(LPAD(TO_HEX(id::bigint), 12, '0'))
WHERE ref_code IS NULL;

ALTER TABLE users
  ALTER COLUMN ref_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_ref_code_key'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_ref_code_key UNIQUE (ref_code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_ref_code ON users (ref_code);
