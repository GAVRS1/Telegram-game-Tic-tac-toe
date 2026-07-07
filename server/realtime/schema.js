import { ensureSchema, getPool } from "../db.js";

let rtSchemaPromise = null;

const RT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS rt_sessions (
    sid           TEXT PRIMARY KEY,
    uid           TEXT,
    name          TEXT NOT NULL DEFAULT '',
    username      TEXT NOT NULL DEFAULT '',
    avatar        TEXT NOT NULL DEFAULT '',
    is_verified   BOOLEAN NOT NULL DEFAULT FALSE,
    last_opponent TEXT,
    last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_rt_sessions_uid ON rt_sessions (uid);
  CREATE INDEX IF NOT EXISTS idx_rt_sessions_last_seen ON rt_sessions (last_seen);

  CREATE TABLE IF NOT EXISTS rt_queue (
    uid       TEXT PRIMARY KEY,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS rt_games (
    id           TEXT PRIMARY KEY,
    x_uid        TEXT NOT NULL,
    o_uid        TEXT NOT NULL,
    board        JSONB NOT NULL DEFAULT '[null,null,null,null,null,null,null,null,null]'::jsonb,
    turn         TEXT NOT NULL DEFAULT 'X',
    round_wins_x INTEGER NOT NULL DEFAULT 0,
    round_wins_o INTEGER NOT NULL DEFAULT 0,
    round_number INTEGER NOT NULL DEFAULT 1,
    target_wins  INTEGER NOT NULL DEFAULT 3,
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_rt_games_x ON rt_games (x_uid) WHERE status = 'active';
  CREATE INDEX IF NOT EXISTS idx_rt_games_o ON rt_games (o_uid) WHERE status = 'active';

  CREATE TABLE IF NOT EXISTS rt_outbox (
    id         BIGSERIAL PRIMARY KEY,
    uid        TEXT NOT NULL,
    payload    JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_rt_outbox_uid_id ON rt_outbox (uid, id);

  CREATE TABLE IF NOT EXISTS rt_rematch (
    pair_key   TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
  );
`;

export function ensureRtSchema() {
  if (rtSchemaPromise) return rtSchemaPromise;
  rtSchemaPromise = (async () => {
    const pool = getPool();
    if (!pool) throw new Error("rt.db_unavailable");
    await ensureSchema();
    await pool.query(RT_SCHEMA_SQL);
    return true;
  })();
  rtSchemaPromise.catch(() => {
    rtSchemaPromise = null;
  });
  return rtSchemaPromise;
}
