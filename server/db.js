// server/db.js
import pg from "pg";
import { ACHIEVEMENTS, evaluateAchievement } from "./achievements.js";
import {
  generateUniqueReferralCode,
  normalizeReferralCode,
} from "./common/referral.js";
import { buildReferralPayload } from "./common/startPayload.js";

let pool = null;
const DEFAULT_BOT_USERNAME = "TTToeONL_bot";

function buildReferralLink(refCode) {
  if (!refCode) return "";
  const payload = buildReferralPayload(refCode);
  if (!payload) return "";
  const botUsername = String(
    process.env.TELEGRAM_BOT_USERNAME ||
      process.env.BOT_USERNAME ||
      DEFAULT_BOT_USERNAME,
  ).trim();
  if (!botUsername) return "";
  return `https://t.me/${botUsername}/play?startapp=${encodeURIComponent(payload)}`;
}

export function getPool() {
  if (pool) return pool;

  const hasUrl = !!process.env.DATABASE_URL;
  const cfg = hasUrl
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: parseSsl(process.env.PGSSL),
      }
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
    if (s === "require" || s === "true" || s === "1")
      return { rejectUnauthorized: false };
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
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_users_wins ON users (wins DESC, updated_at DESC);`,
  );
  await p.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS games_played INTEGER NOT NULL DEFAULT 0;`,
  );
  await p.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS losses INTEGER NOT NULL DEFAULT 0;`,
  );
  await p.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS draws INTEGER NOT NULL DEFAULT 0;`,
  );
  await p.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS invites_count INTEGER NOT NULL DEFAULT 0;`,
  );
  await p.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS coins_balance BIGINT NOT NULL DEFAULT 0;`,
  );
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_code TEXT;`);
  await p.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_source TEXT;`,
  );
  await p.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_payload TEXT;`,
  );
  await p.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_at TIMESTAMPTZ;`,
  );
  await p.query(`
    UPDATE users
       SET ref_code = 'U' || UPPER(LPAD(TO_HEX(id::bigint), 12, '0'))
     WHERE ref_code IS NULL;
  `);
  await p.query(`ALTER TABLE users ALTER COLUMN ref_code SET NOT NULL;`);
  await p.query(`
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
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_users_ref_code ON users (ref_code);`,
  );
  await p.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      inviter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (inviter_id, invited_id)
    );
  `);
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_invited_unique ON referrals (invited_id);`,
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals (inviter_id);`,
  );
  await p.query(`CREATE TABLE IF NOT EXISTS coin_transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL,
    reason TEXT NOT NULL,
    event_key TEXT NOT NULL,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
  await p.query(
    `
      UPDATE coin_transactions
      SET event_key = CONCAT('legacy:', id::text)
      WHERE event_key IS NULL OR BTRIM(event_key) = '';
    `,
  );
  await p.query(`ALTER TABLE coin_transactions ALTER COLUMN event_key SET NOT NULL;`);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_created ON coin_transactions (user_id, created_at DESC);`,
  );
  await p.query(`DROP INDEX IF EXISTS idx_coin_transactions_event_key_unique;`);
  await p.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_transactions_event_key_unique ON coin_transactions (event_key);`,
  );
  await p.query(`
    CREATE TABLE IF NOT EXISTS monitoring_events (
      id BIGSERIAL PRIMARY KEY,
      event_name TEXT NOT NULL,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_monitoring_events_name_created ON monitoring_events (event_name, created_at DESC);`,
  );
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
  await p.query(
    `ALTER TABLE achievements ADD COLUMN IF NOT EXISTS icon TEXT DEFAULT '';`,
  );
  await p.query(
    `ALTER TABLE achievements ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;`,
  );
  await p.query(
    `ALTER TABLE achievements ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;`,
  );
  await p.query(
    `ALTER TABLE achievements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
  );
  await p.query(
    `ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;`,
  );
  await p.query(
    `ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress_value NUMERIC NOT NULL DEFAULT 0;`,
  );
  await p.query(
    `ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS progress_percent NUMERIC NOT NULL DEFAULT 0;`,
  );
  await p.query(
    `ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS unlocked BOOLEAN NOT NULL DEFAULT false;`,
  );
  await p.query(
    `ALTER TABLE user_achievements ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;`,
  );
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
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_invites_status ON invites (status);`,
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_invites_host ON invites (host_user_id);`,
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_invites_expires ON invites (expires_at);`,
  );
  await ensureAchievementDefinitions(p);
  return true;
}

function isNumericId(id) {
  return typeof id === "number"
    ? Number.isFinite(id)
    : typeof id === "string" && /^[0-9]+$/.test(id);
}

export async function upsertUser({
  id,
  username,
  avatar_url,
  registrationSource = null,
  registrationPayload = null,
}) {
  const p = getPool();
  if (!p) return;
  if (!isNumericId(id)) return;

  const n = Number(id);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const refCode = await generateUniqueReferralCode(p);
    try {
      await p.query(
        `
        INSERT INTO users (id, username, avatar_url, ref_code, registration_source, registration_payload, registration_at)
        VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 IS NULL THEN NULL ELSE NOW() END)
        ON CONFLICT (id) DO UPDATE
          SET username = EXCLUDED.username,
              avatar_url = EXCLUDED.avatar_url,
              registration_source = COALESCE(users.registration_source, $5),
              registration_payload = COALESCE(users.registration_payload, $6),
              registration_at = COALESCE(users.registration_at, CASE WHEN $5 IS NULL THEN NULL ELSE NOW() END),
              updated_at = NOW();
      `,
        [
          n,
          username || null,
          avatar_url || null,
          refCode,
          registrationSource,
          registrationPayload,
        ],
      );
      return;
    } catch (error) {
      if (
        error?.code === "23505" &&
        typeof error.constraint === "string" &&
        error.constraint.includes("ref_code")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not allocate unique ref_code for user");
}

async function upsertStats(id, { games = 0, wins = 0, losses = 0, draws = 0 }) {
  const p = getPool();
  if (!p) return;
  if (!isNumericId(id)) return;

  const n = Number(id);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const refCode = await generateUniqueReferralCode(p);
    try {
      await p.query(
        `
        INSERT INTO users (id, games_played, wins, losses, draws, ref_code)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          games_played = users.games_played + EXCLUDED.games_played,
          wins         = users.wins + EXCLUDED.wins,
          losses       = users.losses + EXCLUDED.losses,
          draws        = users.draws + EXCLUDED.draws,
          updated_at   = NOW();
      `,
        [n, games, wins, losses, draws, refCode],
      );
      return;
    } catch (error) {
      if (
        error?.code === "23505" &&
        typeof error.constraint === "string" &&
        error.constraint.includes("ref_code")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not allocate unique ref_code for stats upsert");
}

export async function recordPlayerResult(id, result) {
  if (!isNumericId(id)) return;
  const increments = { games: 1, wins: 0, losses: 0, draws: 0 };
  if (result === "win") increments.wins = 1;
  else if (result === "loss") increments.losses = 1;
  else if (result === "draw") increments.draws = 1;
  await upsertStats(id, increments);
  return refreshUserAchievements(id);
}

export async function recordMatchOutcome({
  winnerId = null,
  loserId = null,
  drawIds = [],
}) {
  const unlockedByUser = {};
  if (winnerId) unlockedByUser[String(winnerId)] = await recordPlayerResult(winnerId, "win");
  if (loserId) unlockedByUser[String(loserId)] = await recordPlayerResult(loserId, "loss");
  const uniqueDraws = Array.from(new Set(drawIds)).filter(isNumericId);
  for (const id of uniqueDraws) {
    unlockedByUser[String(id)] = await recordPlayerResult(id, "draw");
  }
  return unlockedByUser;
}

export async function getLeaders(limit = 20) {
  const p = getPool();
  if (!p) return [];

  const { rows } = await p.query(
    `
      SELECT id, username, avatar_url, games_played, wins, losses, draws, invites_count, coins_balance,
             CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
      FROM users
      ORDER BY wins DESC, updated_at DESC
      LIMIT $1;
    `,
    [limit],
  );
  return rows;
}

export async function getLeadersByAchievements(limit = 20) {
  const p = getPool();
  if (!p) return [];

  const { rows } = await p.query(
    `
      SELECT u.id, u.username, u.avatar_url, u.games_played, u.wins, u.losses, u.draws, u.invites_count, u.coins_balance,
             COUNT(ua.achievement_id)::INT AS achievements_unlocked,
             CASE WHEN u.games_played > 0 THEN ROUND((u.wins::decimal / u.games_played) * 100) ELSE 0 END AS win_rate
      FROM users u
      LEFT JOIN user_achievements ua
        ON ua.user_id = u.id
       AND ua.unlocked = true
      GROUP BY u.id
      ORDER BY achievements_unlocked DESC, u.updated_at DESC
      LIMIT $1;
    `,
    [limit],
  );
  return rows;
}

export async function getLeadersByInvites(limit = 20) {
  const p = getPool();
  if (!p) return [];

  const { rows } = await p.query(
    `
      SELECT
        u.id,
        u.username,
        u.avatar_url,
        u.games_played,
        u.wins,
        u.losses,
        u.draws,
        u.coins_balance,
        COALESCE(r.invites_count, 0)::INT AS invites_count,
        CASE WHEN u.games_played > 0 THEN ROUND((u.wins::decimal / u.games_played) * 100) ELSE 0 END AS win_rate
      FROM users u
      LEFT JOIN (
        SELECT inviter_id, COUNT(*)::INT AS invites_count
        FROM referrals
        GROUP BY inviter_id
      ) r ON r.inviter_id = u.id
      ORDER BY COALESCE(r.invites_count, 0) DESC, u.updated_at DESC
      LIMIT $1;
    `,
    [limit],
  );
  return rows;
}

export async function getLeadersByCoins(limit = 20) {
  const p = getPool();
  if (!p) return [];

  const { rows } = await p.query(
    `
      SELECT id, username, avatar_url, games_played, wins, losses, draws, invites_count, coins_balance,
             CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
      FROM users
      ORDER BY coins_balance DESC, updated_at DESC
      LIMIT $1;
    `,
    [limit],
  );
  return rows;
}

export async function getInvitedFriendsCount(inviterId) {
  const p = getPool();
  if (!p) return 0;
  if (!isNumericId(inviterId)) return 0;

  const { rows } = await p.query(
    `
      SELECT COUNT(*)::INT AS invites_count
      FROM referrals
      WHERE inviter_id = $1;
    `,
    [Number(inviterId)],
  );
  return Number(rows[0]?.invites_count || 0);
}

export async function getUserProfile(id) {
  const p = getPool();
  if (!p) return null;
  if (!isNumericId(id)) return null;

  const n = Number(id);
  const { rows } = await p.query(
    `
    SELECT id, username, avatar_url, games_played, wins, losses, draws, coins_balance, ref_code,
          created_at, updated_at,
           CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
    FROM users
    WHERE id = $1;
  `,
    [n],
  );
  const profile = rows[0] || null;
  if (!profile) return null;
  profile.ref_link = buildReferralLink(profile.ref_code);

  const invitedUsersResult = await p.query(
    `
      SELECT u.id, u.username, u.avatar_url, r.created_at
      FROM referrals r
      INNER JOIN users u ON u.id = r.invited_id
      WHERE r.inviter_id = $1
      ORDER BY r.created_at DESC, u.id DESC;
    `,
    [n],
  );
  profile.invited_users = invitedUsersResult.rows || [];
  profile.invited_count = profile.invited_users.length;

  try {
    await refreshUserAchievements(n);
    const achievements = await getUserAchievements(n);
    profile.achievements = achievements;
    profile.achievements_summary = {
      total: achievements.length,
      unlocked: achievements.filter((a) => a.unlocked).length,
    };
  } catch (error) {
    console.error("getUserProfile achievements error:", error);
  }

  try {
    profile.recent_coin_awards = await getUserCoinTransactions(n, 20);
  } catch (error) {
    console.error("getUserProfile recent_coin_awards error:", error);
  }

  return profile;
}

export async function getUserCoinTransactions(id, limit = 20) {
  const p = getPool();
  if (!p) return [];
  if (!isNumericId(id)) return [];

  const n = Number(id);
  const normalizedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const { rows } = await p.query(
    `
      SELECT id, user_id, amount, reason, event_key, meta, created_at
      FROM coin_transactions
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2;
    `,
    [n, normalizedLimit],
  );
  return rows;
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
    [code, String(hostUserId), expiresAt],
  );
  return rows[0] || null;
}

export async function getInvite(code) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query(`SELECT * FROM invites WHERE code = $1;`, [
    code,
  ]);
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
    [String(hostUserId)],
  );
  return rows[0] || null;
}

export async function acceptInvite({ code, guestUserId }) {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
    UPDATE invites
       SET status = 'accepted',
           guest_user_id = $2
     WHERE code = $1
       AND status = 'pending'
       AND expires_at > NOW()
    RETURNING *;
  `,
      [code, String(guestUserId)],
    );

    const accepted = rows[0] || null;
    if (!accepted) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query("COMMIT");
    return accepted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function bindReferral({ inviterRefCode, invitedId }) {
  const p = getPool();
  if (!p) return { linked: false, reason: "db_unavailable", inviterId: null, invitedId: null };
  if (!isNumericId(invitedId)) return { linked: false, reason: "invalid_id", inviterId: null, invitedId: null };

  const invited = Number(invitedId);
  const normalizedRefCode = normalizeReferralCode(inviterRefCode);
  if (!normalizedRefCode) return { linked: false, reason: "invalid_ref_code", inviterId: null, invitedId: invited };

  const client = await p.connect();
  try {
    await client.query("BEGIN");

    const inviterLookup = await client.query(
      `
        SELECT id
        FROM users
        WHERE ref_code = $1
        LIMIT 1;
      `,
      [normalizedRefCode],
    );
    const inviter = Number(inviterLookup.rows[0]?.id);
    if (!Number.isFinite(inviter)) {
      await client.query("ROLLBACK");
      return { linked: false, reason: "inviter_not_found", inviterId: null, invitedId: invited };
    }
    if (inviter === invited) {
      await client.query("ROLLBACK");
      return { linked: false, reason: "self_referral", inviterId: inviter, invitedId: invited };
    }

    const alreadyLinked = await client.query(
      `
        SELECT inviter_id
        FROM referrals
        WHERE invited_id = $1
        LIMIT 1;
      `,
      [invited],
    );
    if (alreadyLinked.rowCount > 0) {
      await client.query("ROLLBACK");
      return { linked: false, reason: "invited_already_has_referrer", inviterId: inviter, invitedId: invited };
    }

    const { rows } = await client.query(
      `
        INSERT INTO referrals (inviter_id, invited_id)
        VALUES ($1, $2)
        ON CONFLICT (inviter_id, invited_id) DO NOTHING
        RETURNING inviter_id;
      `,
      [inviter, invited],
    );

    const linked = rows.length > 0;
    if (!linked) {
      await client.query("ROLLBACK");
      return { linked: false, reason: "duplicate_pair", inviterId: inviter, invitedId: invited };
    }

    await client.query(
      `
        UPDATE users
           SET invites_count = invites_count + 1,
               updated_at = NOW()
         WHERE id = $1;
      `,
      [inviter],
    );

    await client.query("COMMIT");
    return { linked: true, reason: "linked", inviterId: inviter, invitedId: invited };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
    [code],
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
      ],
    );
  }

  if (ACHIEVEMENTS.length > 0) {
    await p.query(
      `DELETE FROM achievements WHERE id NOT IN (${ACHIEVEMENTS.map((_, i) => `$${i + 1}`).join(", ")});`,
      ACHIEVEMENTS.map((a) => a.id),
    );
  }
}

async function refreshUserAchievements(id) {
  const p = getPool();
  if (!p) return [];
  if (!isNumericId(id)) return [];

  const n = Number(id);
  const { rows } = await p.query(
    `
      SELECT id, games_played, wins, losses, draws,
             CASE WHEN games_played > 0 THEN ROUND((wins::decimal / games_played) * 100) ELSE 0 END AS win_rate
      FROM users
      WHERE id = $1;
    `,
    [n],
  );
  const stats = rows[0];
  if (!stats) return [];
  const newlyUnlocked = [];

  for (const def of ACHIEVEMENTS) {
    const evaluation = evaluateAchievement(def, stats);
    const previousStateResult = await p.query(
      `
        SELECT unlocked
        FROM user_achievements
        WHERE user_id = $1 AND achievement_id = $2
        LIMIT 1;
      `,
      [n, def.id],
    );
    const wasUnlocked = previousStateResult.rows[0]?.unlocked === true;
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
      ],
    );

    if (evaluation.unlocked && !wasUnlocked) {
      newlyUnlocked.push(def.id);
    }
  }

  return newlyUnlocked;
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
    [n],
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


export async function getAdminReferralDiagnostics() {
  const p = getPool();
  if (!p) {
    return {
      referral_link_opened: 0,
      referral_bound: 0,
      successful_registrations: 0,
      coins_by_source: [],
    };
  }

  const [linkOpened, bound, successfulRegs, coinsBySource] = await Promise.all([
    p.query(
      `
        SELECT COUNT(*)::BIGINT AS total
        FROM monitoring_events
        WHERE event_name = 'referral_link_opened';
      `,
    ),
    p.query(
      `
        SELECT COUNT(*)::BIGINT AS total
        FROM monitoring_events
        WHERE event_name = 'referral_bound';
      `,
    ),
    p.query(
      `
        SELECT COUNT(*)::BIGINT AS total
        FROM referrals;
      `,
    ),
    p.query(
      `
        SELECT
          COALESCE(NULLIF(meta->>'source', ''), reason, 'unknown') AS source,
          COUNT(*)::BIGINT AS transactions,
          COALESCE(SUM(amount), 0)::BIGINT AS coins_awarded
        FROM coin_transactions
        GROUP BY 1
        ORDER BY coins_awarded DESC, transactions DESC;
      `,
    ),
  ]);

  return {
    referral_link_opened: Number(linkOpened.rows[0]?.total || 0),
    referral_bound: Number(bound.rows[0]?.total || 0),
    successful_registrations: Number(successfulRegs.rows[0]?.total || 0),
    coins_by_source: coinsBySource.rows.map((row) => ({
      source: row.source,
      transactions: Number(row.transactions || 0),
      coins_awarded: Number(row.coins_awarded || 0),
    })),
  };
}
