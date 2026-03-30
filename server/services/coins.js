import { getPool } from "../db.js";

export const COIN_REASONS = Object.freeze({
  MATCH_WIN: "match_win",
  REFERRAL_SIGNUP: "referral_signup",
  ACHIEVEMENT_UNLOCK: "achievement_unlock",
  DAILY_TASK_COMPLETE: "daily_task_complete",
});

const ALLOWED_REASONS = new Set(Object.values(COIN_REASONS));

function assertNumericUserId(userId) {
  const value = typeof userId === "number" ? userId : Number(userId);
  if (!Number.isFinite(value)) {
    throw new Error("coins.invalid_user_id");
  }
  return value;
}

function assertAwardAmount(amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("coins.invalid_amount");
  }
  return amount;
}

function assertReason(reason) {
  const normalized = String(reason || "").trim().toLowerCase();
  if (!ALLOWED_REASONS.has(normalized)) {
    throw new Error("coins.invalid_reason");
  }
  return normalized;
}

function normalizeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return {};
  }
  return meta;
}

function normalizeEventKey(meta) {
  const rawEventKey = typeof meta?.event_key === "string" ? meta.event_key.trim() : "";
  return rawEventKey || null;
}

export async function awardCoins({ userId, reason, amount, meta = {} }) {
  const pool = getPool();
  if (!pool) {
    throw new Error("coins.db_unavailable");
  }

  const normalizedUserId = assertNumericUserId(userId);
  const normalizedReason = assertReason(reason);
  const normalizedAmount = assertAwardAmount(amount);
  const normalizedMeta = normalizeMeta(meta);
  const eventKey = normalizeEventKey(normalizedMeta);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertResult = await client.query(
      `
        INSERT INTO coin_transactions (user_id, amount, reason, event_key, meta)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
        RETURNING id, user_id, amount, reason, event_key, meta, created_at;
      `,
      [normalizedUserId, normalizedAmount, normalizedReason, eventKey, JSON.stringify(normalizedMeta)]
    );

    if (insertResult.rowCount === 0) {
      const existing = await client.query(
        `
          SELECT id, user_id, amount, reason, event_key, meta, created_at
          FROM coin_transactions
          WHERE event_key = $1
          LIMIT 1;
        `,
        [eventKey]
      );

      await client.query("COMMIT");
      return {
        ok: true,
        alreadyAwarded: true,
        transaction: existing.rows[0] || null,
      };
    }

    const updateResult = await client.query(
      `
        UPDATE users
        SET coins_balance = coins_balance + $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, coins_balance;
      `,
      [normalizedUserId, normalizedAmount]
    );

    if (updateResult.rowCount === 0) {
      throw new Error("coins.user_not_found");
    }

    await client.query("COMMIT");
    return {
      ok: true,
      alreadyAwarded: false,
      transaction: insertResult.rows[0],
      balance: Number(updateResult.rows[0].coins_balance),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
