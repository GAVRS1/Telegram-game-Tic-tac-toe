// server/db.js
import pg from "pg";

let pool = null;

export function getPool() {
  if (pool) return pool;

  const hasUrl = !!process.env.DATABASE_URL;
  const cfg = hasUrl
    ? { connectionString: process.env.DATABASE_URL, ssl: parseSsl(process.env.PGSSL) }
    : {
        host: process.env.PGHOST,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        ssl: parseSsl(process.env.PGSSL),
      };

  if (!hasUrl && !cfg.host) return null;

  pool = new pg.Pool(cfg);
  return pool;
}

function parseSsl(v) {
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "require" || s === "true" || s === "1") return { rejectUnauthorized: false };
  }
  return false;
}

export async function ensureSchema() {
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         BIGINT PRIMARY KEY,
      username   TEXT,
      avatar_url TEXT,
      games_played INTEGER NOT NULL DEFAULT 0,
      wins       INTEGER NOT NULL DEFAULT 0,
      losses     INTEGER NOT NULL DEFAULT 0,
      draws      INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_users_wins ON users (wins DESC, updated_at DESC);`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS games_played INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS losses INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS draws INTEGER NOT NULL DEFAULT 0;`);
  return true;
}

function isNumericId(id) {
  return typeof id === 'number'
    ? Number.isFinite(id)
    : typeof id === 'string' && /^[0-9]+$/.test(id);
}

export async function upsertUser({ id, username, avatar_url }) {
  const p = getPool();
  if (!p) return;
  if (!isNumericId(id)) return; // пишем только TG uid

  const n = Number(id);
  await p.query(
    `
    INSERT INTO users (id, username, avatar_url)
    VALUES ($1, $2, $3)
    ON CONFLICT (id) DO UPDATE
      SET username = EXCLUDED.username,
          avatar_url = EXCLUDED.avatar_url,
          updated_at = NOW();
  `,
    [n, username || null, avatar_url || null]
  );
}

async function upsertStats(id, { games = 0, wins = 0, losses = 0, draws = 0 }) {
  const p = getPool();
  if (!p) return;
  if (!isNumericId(id)) return;

  const n = Number(id);
  await p.query(
    `
    INSERT INTO users (id, games_played, wins, losses, draws)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET
      games_played = users.games_played + EXCLUDED.games_played,
      wins         = users.wins + EXCLUDED.wins,
      losses       = users.losses + EXCLUDED.losses,
      draws        = users.draws + EXCLUDED.draws,
      updated_at   = NOW();
  `,
    [n, games, wins, losses, draws]
  );
}

export async function recordPlayerResult(id, result) {
  if (!isNumericId(id)) return;
  const increments = { games: 1, wins: 0, losses: 0, draws: 0 };
  if (result === "win") increments.wins = 1;
  else if (result === "loss") increments.losses = 1;
  else if (result === "draw") increments.draws = 1;
  await upsertStats(id, increments);
}

export async function recordMatchOutcome({ winnerId = null, loserId = null, drawIds = [] }) {
  const tasks = [];
  if (winnerId) tasks.push(recordPlayerResult(winnerId, "win"));
  if (loserId) tasks.push(recordPlayerResult(loserId, "loss"));
  const uniqueDraws = Array.from(new Set(drawIds)).filter(isNumericId);
  for (const id of uniqueDraws) tasks.push(recordPlayerResult(id, "draw"));
  await Promise.all(tasks);
}

export async function getLeaders(limit = 20) {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `
    SELECT id, username, avatar_url, games_played, wins, losses, draws,
           CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
    FROM users
    ORDER BY wins DESC, updated_at DESC
    LIMIT $1;
  `,
    [limit]
  );
  return rows;
}

export async function getUserProfile(id) {
  const p = getPool();
  if (!p) return null;
  if (!isNumericId(id)) return null;

  const n = Number(id);
  const { rows } = await p.query(
    `
    SELECT id, username, avatar_url, games_played, wins, losses, draws,
           created_at, updated_at,
           CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
    FROM users
    WHERE id = $1;
  `,
    [n]
  );
  return rows[0] || null;
}
