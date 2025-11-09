-- migrations/001_init.sql
CREATE TABLE IF NOT EXISTS users (
  id          BIGINT PRIMARY KEY,
  username    TEXT,
  avatar_url  TEXT,
  games_played INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  draws       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_wins ON users (wins DESC, updated_at DESC);
