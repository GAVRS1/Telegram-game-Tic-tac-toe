// server/db.js
import pg from "pg";
import { ACHIEVEMENTS, evaluateAchievement } from "./achievements.js";

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
  await p.query(`
    CREATE TABLE IF NOT EXISTS achievements (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL,
      metric       TEXT NOT NULL,
      target       NUMERIC NOT NULL,
      icon         TEXT DEFAULT '',
      order_index  INTEGER NOT NULL DEFAULT 0,
      extra        JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id   TEXT   NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      progress_value   NUMERIC NOT NULL DEFAULT 0,
      progress_percent NUMERIC NOT NULL DEFAULT 0,
      unlocked         BOOLEAN NOT NULL DEFAULT false,
      unlocked_at      TIMESTAMPTZ,
      details          JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, achievement_id)
    );
  `);
  await p.query(`ALTER TABLE achievements ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT '';`);
  await p.query(`ALTER TABLE achievements ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE achievements ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await p.query(`ALTER TABLE achievements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await p.query(`ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await p.query(`ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress_value NUMERIC NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress_percent NUMERIC NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS unlocked BOOLEAN NOT NULL DEFAULT false;`);
  await p.query(`ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS invites (
      code          TEXT PRIMARY KEY,
      host_user_id  TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMPTZ NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      guest_user_id TEXT
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_invites_status ON invites (status);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_invites_host ON invites (host_user_id);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_invites_expires ON invites (expires_at);`);
  await ensureAchievementDefinitions(p);
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
  if (!isNumericId(id)) return;

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
  await refreshUserAchievements(id);
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
  const profile = rows[0] || null;
  if (!profile) return null;

  try {
    await refreshUserAchievements(n);
    const achievements = await getUserAchievements(n);
    profile.achievements = achievements;
    profile.achievements_summary = {
      total: achievements.length,
      unlocked: achievements.filter(a => a.unlocked).length,
    };
  } catch (error) {
    console.error("getUserProfile achievements error:", error);
  }

  return profile;
}

export async function createInvite({ code, hostUserId, expiresAt }) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query(
    `
    INSERT INTO invites (code, host_user_id, expires_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (code) DO NOTHING
    RETURNING *;
  `,
    [code, String(hostUserId), expiresAt]
  );
  return rows[0] || null;
}

export async function getInvite(code) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query(`SELECT * FROM invites WHERE code = $1;`, [code]);
  return rows[0] || null;
}

export async function getPendingInviteByHost(hostUserId) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query(
    `
      SELECT *
      FROM invites
      WHERE host_user_id = $1
        AND status = 'pending'
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1;
    `,
    [String(hostUserId)]
  );
  return rows[0] || null;
}

export async function acceptInvite({ code, guestUserId }) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query(
    `
    UPDATE invites
       SET status = 'accepted',
           guest_user_id = $2
     WHERE code = $1
       AND status = 'pending'
       AND expires_at > NOW()
    RETURNING *;
  `,
    [code, String(guestUserId)]
  );
  return rows[0] || null;
}

export async function expireInvite(code) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query(
    `
    UPDATE invites
       SET status = 'expired'
     WHERE code = $1
       AND status = 'pending'
    RETURNING *;
  `,
    [code]
  );
  return rows[0] || null;
}

async function ensureAchievementDefinitions(p) {
  for (const def of ACHIEVEMENTS) {
    await p.query(
      `
        INSERT INTO achievements (id, name, description, metric, target, icon, order_index, extra, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          metric = EXCLUDED.metric,
          target = EXCLUDED.target,
          icon = EXCLUDED.icon,
          order_index = EXCLUDED.order_index,
          extra = EXCLUDED.extra,
          updated_at = NOW();
      `,
      [
        def.id,
        def.name,
        def.description,
        def.metric,
        def.target,
        def.icon || "",
        def.order || 0,
        JSON.stringify(def.extra || {}),
      ]
    );
  }

  if (ACHIEVEMENTS.length > 0) {
    await p.query(
      `DELETE FROM achievements WHERE id NOT IN (${ACHIEVEMENTS.map((_, i) => `$${i + 1}`).join(", ")});`,
      ACHIEVEMENTS.map((a) => a.id)
    );
  }
}

async function refreshUserAchievements(id) {
  const p = getPool();
  if (!p) return;
  if (!isNumericId(id)) return;

  const n = Number(id);
  const { rows } = await p.query(
    `
      SELECT id, games_played, wins, losses, draws,
             CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
      FROM users
      WHERE id = $1;
    `,
    [n]
  );
  const stats = rows[0];
  if (!stats) return;

  for (const def of ACHIEVEMENTS) {
    const evaluation = evaluateAchievement(def, stats);
    const unlockedAtExpression = evaluation.unlocked
      ? "CASE WHEN user_achievements.unlocked THEN user_achievements.unlocked_at ELSE NOW() END"
      : "CASE WHEN user_achievements.unlocked THEN user_achievements.unlocked_at ELSE NULL END";
    await p.query(
      `
        INSERT INTO user_achievements (user_id, achievement_id, progress_value, progress_percent, unlocked, unlocked_at, details, updated_at)
        VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END, $6::jsonb, NOW())
        ON CONFLICT (user_id, achievement_id) DO UPDATE SET
          progress_value = EXCLUDED.progress_value,
          progress_percent = EXCLUDED.progress_percent,
          unlocked = EXCLUDED.unlocked,
          unlocked_at = ${unlockedAtExpression},
          details = EXCLUDED.details,
          updated_at = NOW();
      `,
      [
        n,
        def.id,
        evaluation.progressValue,
        evaluation.progressPercent,
        evaluation.unlocked,
        JSON.stringify({ ...(def.extra || {}), ...(evaluation.details || {}) }),
      ]
    );
  }
}

export async function getUserAchievements(id) {
  const p = getPool();
  if (!p) return [];
  if (!isNumericId(id)) return [];

  const n = Number(id);
  const { rows } = await p.query(
    `
      SELECT
        a.id,
        a.name,
        a.description,
        a.metric,
        a.target,
        a.icon,
        a.order_index,
        a.extra,
        COALESCE(ua.progress_value, 0)   AS progress_value,
        COALESCE(ua.progress_percent, 0) AS progress_percent,
        COALESCE(ua.unlocked, false)     AS unlocked,
        ua.unlocked_at,
        COALESCE(ua.details, '{}'::jsonb) AS details
      FROM achievements a
      LEFT JOIN user_achievements ua
        ON ua.achievement_id = a.id AND ua.user_id = $1
      ORDER BY a.order_index ASC, a.id ASC;
    `,
    [n]
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    metric: row.metric,
    target: Number(row.target),
    icon: row.icon || "",
    order: Number(row.order_index || 0),
    progress_value: Number(row.progress_value),
    progress_percent: Number(row.progress_percent),
    unlocked: row.unlocked === true,
    unlocked_at: row.unlocked_at,
    extra: row.extra || {},
    details: row.details || {},
  }));
}
