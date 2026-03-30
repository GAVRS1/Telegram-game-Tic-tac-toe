import { awardCoins, COIN_REASONS } from "../../services/coins.js";
import { logCoinAward } from "../../monitoring.js";

const DAILY_TASK_COIN_REWARD = Number(process.env.COIN_REWARD_DAILY_COMPLETE || 30);

function getUtcDateKey(rawDate) {
  if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return rawDate;
  }
  return new Date().toISOString().slice(0, 10);
}

export const registerDailyRoute = ({ app }) => {
  app.post("/daily/complete", async (req, res) => {
    try {
      const userId = String(req.body?.user_id || req.body?.userId || "").trim();
      const dailyKey = String(req.body?.daily_key || req.body?.dailyKey || "default").trim().toLowerCase();
      const dateKey = getUtcDateKey(req.body?.date);

      if (!/^[0-9]+$/.test(userId)) {
        return res.status(400).json({ ok: false, error: "invalid user_id" });
      }
      if (!dailyKey) {
        return res.status(400).json({ ok: false, error: "invalid daily_key" });
      }

      const eventKey = `daily:${userId}:${dailyKey}:${dateKey}`;
      const result = await awardCoins({
        userId,
        reason: COIN_REASONS.DAILY_TASK_COMPLETE,
        amount: DAILY_TASK_COIN_REWARD,
        meta: {
          event_key: eventKey,
          source: "daily_complete",
          daily_key: dailyKey,
          date: dateKey,
        },
      });

      logCoinAward({
        source: "daily_complete",
        eventKey,
        userId,
        reason: COIN_REASONS.DAILY_TASK_COMPLETE,
        amount: DAILY_TASK_COIN_REWARD,
        result: result.alreadyAwarded ? "already_awarded" : "awarded",
        meta: { dailyKey, date: dateKey },
      });

      return res.json({ ok: true, ...result });
    } catch (error) {
      logCoinAward({
        source: "daily_complete",
        eventKey: null,
        userId: req.body?.user_id || req.body?.userId || null,
        reason: COIN_REASONS.DAILY_TASK_COMPLETE,
        amount: DAILY_TASK_COIN_REWARD,
        result: "error",
        error,
        meta: {
          dailyKey: String(req.body?.daily_key || req.body?.dailyKey || "default").trim().toLowerCase(),
          date: getUtcDateKey(req.body?.date),
        },
      });
      console.error("daily complete error:", error);
      return res.status(500).json({ ok: false });
    }
  });
};
