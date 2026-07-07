// HTTP API игры на Netlify Functions: лидерборд, профили, дейлики, приглашения.
// Повторяет маршруты server/http/routes/* без Express.
import crypto from "node:crypto";
import {
  ensureSchema,
  getLeaders,
  getLeadersByAchievements,
  getLeadersByInvites,
  getLeadersByCoins,
  getUserProfile,
  getUserCoinTransactions,
  createInvite,
  getPendingInviteByHost,
} from "../../server/db.js";
import { awardCoins, COIN_REASONS } from "../../server/services/coins.js";
import { logCoinAward } from "../../server/monitoring.js";
import { buildLobbyInvitePayload } from "../../server/common/startPayload.js";

const DAILY_TASK_COIN_REWARD = Number(process.env.COIN_REWARD_DAILY_COMPLETE || 30);
const INVITE_TTL_MS = 1000 * 60 * 30;
const DEFAULT_BOT_USERNAME = "TTToeONL_bot";

let schemaReady = null;
const ready = () => {
  if (!schemaReady) schemaReady = ensureSchema();
  return schemaReady;
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const getUtcDateKey = (rawDate) => {
  if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  return new Date().toISOString().slice(0, 10);
};

const handleLeaders = async (url) => {
  const metric = (url.searchParams.get("metric") || "wins").trim().toLowerCase();
  const metricHandlers = {
    wins: getLeaders,
    achievements: getLeadersByAchievements,
    invites: getLeadersByInvites,
    coins: getLeadersByCoins,
  };
  const loader = metricHandlers[metric];
  if (!loader) {
    return json({ ok: false, error: "invalid metric", allowed: Object.keys(metricHandlers) }, 400);
  }
  const list = await loader(20);
  return json({ ok: true, metric, leaders: list });
};

const handleProfile = async (segments) => {
  const id = segments[1] || "";
  if (!/^[0-9]+$/.test(id)) return json({ ok: false, error: "invalid id" }, 400);
  if (segments[2] === "coin-history") {
    const history = await getUserCoinTransactions(id, 20);
    return json({ ok: true, history });
  }
  const profile = await getUserProfile(id);
  return json({ ok: true, profile });
};

const handleDailyComplete = async (req) => {
  let body = {};
  try {
    body = await req.json();
  } catch {}
  const userId = String(body?.user_id || body?.userId || "").trim();
  const dailyKey = String(body?.daily_key || body?.dailyKey || "default").trim().toLowerCase();
  const dateKey = getUtcDateKey(body?.date);

  if (!/^[0-9]+$/.test(userId)) return json({ ok: false, error: "invalid user_id" }, 400);
  if (!dailyKey) return json({ ok: false, error: "invalid daily_key" }, 400);

  const eventKey = `daily:${userId}:${dailyKey}:${dateKey}`;
  try {
    const result = await awardCoins({
      userId,
      reason: COIN_REASONS.DAILY_TASK_COMPLETE,
      amount: DAILY_TASK_COIN_REWARD,
      meta: { event_key: eventKey, source: "daily_complete", daily_key: dailyKey, date: dateKey },
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
    return json({ ok: true, ...result });
  } catch (error) {
    logCoinAward({
      source: "daily_complete",
      eventKey,
      userId,
      reason: COIN_REASONS.DAILY_TASK_COMPLETE,
      amount: DAILY_TASK_COIN_REWARD,
      result: "error",
      error,
      meta: { dailyKey, date: dateKey },
    });
    console.error("daily complete error:", error);
    return json({ ok: false }, 500);
  }
};

const buildInviteLink = (code) => {
  const botUsername = String(
    process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || DEFAULT_BOT_USERNAME
  ).trim();
  return `https://t.me/${botUsername}/play?startapp=${encodeURIComponent(buildLobbyInvitePayload(code))}`;
};

const handleInviteCreate = async (req) => {
  let body = {};
  try {
    body = await req.json();
  } catch {}
  const hostUserId = String(body?.host_user_id || body?.hostUserId || "").trim();
  if (!hostUserId) return json({ ok: false, error: "host_user_id required" }, 400);

  const pending = await getPendingInviteByHost(hostUserId);
  let invite = pending && new Date(pending.expires_at).getTime() > Date.now() ? pending : null;
  if (!invite) {
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    for (let i = 0; i < 5 && !invite; i += 1) {
      const code = crypto.randomBytes(8).toString("base64url").slice(0, 10);
      invite = await createInvite({ code, hostUserId, expiresAt });
    }
  }
  if (!invite) return json({ ok: false, error: "invite creation failed" }, 500);
  return json({
    ok: true,
    code: invite.code,
    link: buildInviteLink(invite.code),
    expiresAt: invite.expires_at,
  });
};

const handleConfig = (req) => {
  const origin = new URL(req.url).origin;
  const publicUrl = (process.env.PUBLIC_URL || "").trim() || origin;
  return json({ webAppUrl: publicUrl, wsUrl: "", transport: "polling" });
};

export default async (req) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const root = segments[0] || "";

  try {
    if (root === "config.json") return handleConfig(req);
    await ready();
    if (root === "leaders" && req.method === "GET") return handleLeaders(url);
    if (root === "profile" && req.method === "GET") return handleProfile(segments);
    if (root === "daily" && segments[1] === "complete" && req.method === "POST") {
      return handleDailyComplete(req);
    }
    if (root === "invite" && req.method === "POST") return handleInviteCreate(req);
    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    console.error(`api function error (${url.pathname}):`, error);
    return json({ ok: false }, 500);
  }
};

export const config = {
  path: ["/leaders", "/profile/*", "/daily/*", "/invite", "/config.json"],
};
