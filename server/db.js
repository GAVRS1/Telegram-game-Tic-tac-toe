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
      wins       INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_users_wins ON users (wins DESC, updated_at DESC);`);
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

export async function incWin(id) {
  const p = getPool();
  if (!p) return;
  if (!isNumericId(id)) return; // только TG uid

  const n = Number(id);
  await p.query(`UPDATE users SET wins = wins + 1, updated_at = NOW() WHERE id = $1;`, [n]);
}

export async function getLeaders(limit = 20) {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT id, username, avatar_url, wins FROM users ORDER BY wins DESC, updated_at DESC LIMIT $1;`,
    [limit]
  );
  return rows;
}
