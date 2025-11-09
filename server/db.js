// server/db.js
import pg from "pg";

const ACHIEVEMENT_DEFINITIONS = [
  {
    id: "rookie_steps",
    name: "Первые шаги",
    description: "Сыграйте 5 игр",
    icon: "🥾",
    difficulty: "bronze",
    metric: "games_played",
    target: 5,
    requires_games: 0,
    points: 10,
    order_index: 1,
  },
  {
    id: "veteran_player",
    name: "Ветеран",
    description: "Сыграйте 25 игр",
    icon: "🛡️",
    difficulty: "silver",
    metric: "games_played",
    target: 25,
    requires_games: 0,
    points: 25,
    order_index: 2,
  },
  {
    id: "first_victory",
    name: "Первая победа",
    description: "Выиграйте свою первую игру",
    icon: "🏆",
    difficulty: "bronze",
    metric: "wins",
    target: 1,
    requires_games: 0,
    points: 10,
    order_index: 3,
  },
  {
    id: "ten_wins",
    name: "Охотник за победами",
    description: "Наберите 10 побед",
    icon: "⚔️",
    difficulty: "silver",
    metric: "wins",
    target: 10,
    requires_games: 0,
    points: 30,
    order_index: 4,
  },
  {
    id: "streak_master",
    name: "Мастер серии",
    description: "Достигните серии из 3 побед",
    icon: "🔥",
    difficulty: "gold",
    metric: "best_win_streak",
    target: 3,
    requires_games: 0,
    points: 40,
    order_index: 5,
  },
  {
    id: "streak_legend",
    name: "Легенда серии",
    description: "Достигните серии из 7 побед",
    icon: "🌟",
    difficulty: "platinum",
    metric: "best_win_streak",
    target: 7,
    requires_games: 0,
    points: 80,
    order_index: 6,
  },
  {
    id: "strategist",
    name: "Стратег",
    description: "Сыграйте 5 ничьих",
    icon: "♟️",
    difficulty: "silver",
    metric: "draws",
    target: 5,
    requires_games: 0,
    points: 20,
    order_index: 7,
  },
  {
    id: "win_rate_elite",
    name: "Элита",
    description: "Поддерживайте винрейт 60% после 20 игр",
    icon: "🧠",
    difficulty: "gold",
    metric: "win_rate",
    target: 60,
    requires_games: 20,
    points: 60,
    order_index: 8,
  },
];

let pool = null;
let achievementsCache = { items: null, loadedAt: 0 };

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
      current_win_streak INTEGER NOT NULL DEFAULT 0,
      best_win_streak INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_users_wins ON users (wins DESC, updated_at DESC);`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS games_played INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS losses INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS draws INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS current_win_streak INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS best_win_streak INTEGER NOT NULL DEFAULT 0;`);
  await p.query(`
    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      metric TEXT NOT NULL,
      target INTEGER NOT NULL,
      requires_games INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
      progress INTEGER NOT NULL DEFAULT 0,
      percent INTEGER NOT NULL DEFAULT 0,
      unlocked_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, achievement_id)
    );
  `);
  await syncAchievementDefinitions();
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

export async function recordMatchOutcome({ winnerId = null, loserId = null, drawIds = [] }) {
  const uniqueDraws = Array.from(new Set(drawIds)).filter(isNumericId);
  if (isNumericId(winnerId)) {
    await applyResult(Number(winnerId), "win");
  }
  if (isNumericId(loserId)) {
    await applyResult(Number(loserId), "loss");
  }
  for (const id of uniqueDraws) {
    await applyResult(Number(id), "draw");
  }
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
  await updateAchievementsForUser(n).catch(() => {});
  const { rows } = await p.query(
    `
    SELECT id, username, avatar_url, games_played, wins, losses, draws,
           current_win_streak, best_win_streak,
           created_at, updated_at,
           CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
    FROM users
    WHERE id = $1;
  `,
    [n]
  );
  const profile = rows[0] || null;
  if (!profile) return null;

  const achievements = await buildUserAchievements(n, profile);
  return { ...profile, achievements };
}

async function syncAchievementDefinitions() {
  const p = getPool();
  if (!p) return;
  if (!ACHIEVEMENT_DEFINITIONS.length) return;

  const values = [];
  const tuples = ACHIEVEMENT_DEFINITIONS.map((def, idx) => {
    const base = idx * 10;
    values.push(
      def.id,
      def.name,
      def.description,
      def.icon,
      def.difficulty,
      def.metric,
      def.target,
      def.requires_games || 0,
      def.points || 0,
      def.order_index || (idx + 1)
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
  });

  await p.query(
    `
    INSERT INTO achievements (id, name, description, icon, difficulty, metric, target, requires_games, points, order_index)
    VALUES ${tuples.join(",\n           ")}
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      difficulty = EXCLUDED.difficulty,
      metric = EXCLUDED.metric,
      target = EXCLUDED.target,
      requires_games = EXCLUDED.requires_games,
      points = EXCLUDED.points,
      order_index = EXCLUDED.order_index,
      updated_at = NOW();
  `,
    values
  );

  achievementsCache = { items: null, loadedAt: 0 };
}

async function getAchievementDefinitions({ force = false } = {}) {
  if (!force && achievementsCache.items && Date.now() - achievementsCache.loadedAt < 60_000) {
    return achievementsCache.items;
  }

  const p = getPool();
  if (!p) return [];

  const { rows } = await p.query(
    `SELECT id, name, description, icon, difficulty, metric, target, requires_games, points, order_index
     FROM achievements
     ORDER BY order_index ASC, name ASC;`
  );
  achievementsCache = { items: rows, loadedAt: Date.now() };
  return rows;
}

async function applyResult(userId, result) {
  const p = getPool();
  if (!p) return;
  if (!isNumericId(userId)) return;

  const n = Number(userId);
  const { rows } = await p.query(
    `SELECT current_win_streak, best_win_streak FROM users WHERE id = $1;`,
    [n]
  );
  const current = rows[0] || { current_win_streak: 0, best_win_streak: 0 };

  let currentStreak = Number(current.current_win_streak) || 0;
  let bestStreak = Number(current.best_win_streak) || 0;

  if (result === "win") {
    currentStreak += 1;
    if (currentStreak > bestStreak) bestStreak = currentStreak;
  } else {
    currentStreak = 0;
  }

  const wins = result === "win" ? 1 : 0;
  const losses = result === "loss" ? 1 : 0;
  const draws = result === "draw" ? 1 : 0;

  await p.query(
    `
    INSERT INTO users (id, games_played, wins, losses, draws, current_win_streak, best_win_streak)
    VALUES ($1, 1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      games_played = users.games_played + 1,
      wins = users.wins + EXCLUDED.wins,
      losses = users.losses + EXCLUDED.losses,
      draws = users.draws + EXCLUDED.draws,
      current_win_streak = $5,
      best_win_streak = $6,
      updated_at = NOW();
  `,
    [n, wins, losses, draws, currentStreak, bestStreak]
  );

  await updateAchievementsForUser(n);
}

function computeAchievementProgress(def, stats) {
  const target = Number(def.target) || 1;
  const requiresGames = Number(def.requires_games || 0);
  const gamesPlayed = Number(stats.games_played || 0);
  const wins = Number(stats.wins || 0);
  const draws = Number(stats.draws || 0);
  const bestWinStreak = Number(stats.best_win_streak || 0);
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;

  let rawValue = 0;
  let requirementMet = true;

  switch (def.metric) {
    case "games_played":
      rawValue = gamesPlayed;
      break;
    case "wins":
      rawValue = wins;
      break;
    case "draws":
      rawValue = draws;
      break;
    case "best_win_streak":
      rawValue = bestWinStreak;
      break;
    case "win_rate":
      requirementMet = gamesPlayed >= requiresGames;
      rawValue = requirementMet ? winRate : 0;
      break;
    default:
      rawValue = 0;
      break;
  }

  const value = Math.max(0, Math.min(rawValue, target));
  const percent = target > 0 ? Math.round((value / target) * 100) : 0;
  const unlocked = requirementMet && rawValue >= target;

  return {
    value,
    rawValue,
    percent: Math.min(100, percent),
    unlocked,
    requirementMet,
  };
}

async function updateAchievementsForUser(userId) {
  const p = getPool();
  if (!p) return;
  if (!isNumericId(userId)) return;

  const n = Number(userId);
  const definitions = await getAchievementDefinitions();
  if (!definitions.length) return;

  const { rows } = await p.query(
    `SELECT games_played, wins, losses, draws, current_win_streak, best_win_streak FROM users WHERE id = $1;`,
    [n]
  );
  const stats = rows[0];
  if (!stats) return;

  const tasks = [];
  for (const def of definitions) {
    const info = computeAchievementProgress(def, stats);
    const params = [
      n,
      def.id,
      Math.round(info.value),
      info.percent,
      info.unlocked,
    ];
    tasks.push(
      p.query(
        `
        INSERT INTO user_achievements (user_id, achievement_id, progress, percent, unlocked_at)
        VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN NOW() ELSE NULL END)
        ON CONFLICT (user_id, achievement_id) DO UPDATE SET
          progress = EXCLUDED.progress,
          percent = EXCLUDED.percent,
          unlocked_at = CASE
            WHEN user_achievements.unlocked_at IS NOT NULL THEN user_achievements.unlocked_at
            WHEN $5 THEN NOW()
            ELSE user_achievements.unlocked_at
          END,
          updated_at = NOW();
      `,
        params
      )
    );
  }

  await Promise.all(tasks);
}

async function buildUserAchievements(userId, stats) {
  const definitions = await getAchievementDefinitions();
  if (!definitions.length) return [];

  const p = getPool();
  if (!p) return [];

  const { rows } = await p.query(
    `SELECT achievement_id, progress, percent, unlocked_at
     FROM user_achievements
     WHERE user_id = $1;`,
    [userId]
  );
  const byId = new Map(rows.map((row) => [row.achievement_id, row]));

  const gamesPlayed = Number(stats.games_played || 0);
  const wins = Number(stats.wins || 0);
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;
  const enrichedStats = { ...stats, win_rate: winRate };

  return definitions.map((def) => {
    const progressRow = byId.get(def.id) || null;
    const info = computeAchievementProgress(def, enrichedStats);
    const requiresGames = Number(def.requires_games || 0);
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      icon: def.icon,
      difficulty: def.difficulty,
      metric: def.metric,
      target: Number(def.target) || 0,
      requiresGames,
      points: Number(def.points || 0),
      progress: info.rawValue,
      percent: info.percent,
      unlocked: info.unlocked,
      unlocked_at: progressRow?.unlocked_at || null,
      requirementMet: info.requirementMet,
    };
  });
}
