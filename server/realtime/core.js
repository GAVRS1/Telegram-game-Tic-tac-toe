// Realtime-движок поверх HTTP-поллинга для serverless-окружений (Netlify Functions).
// Повторяет протокол сообщений WebSocket-сервера (server/ws/*), но всё состояние
// живёт в Postgres: сессии, очередь матчмейкинга, партии и outbox исходящих сообщений.
import crypto from "node:crypto";
import {
  getPool,
  recordMatchOutcome,
  getUserProfile,
  upsertUser,
  bindReferral,
  createInvite,
  getInvite,
  getPendingInviteByHost,
  acceptInvite,
  expireInvite,
} from "../db.js";
import { awardCoins, COIN_REASONS } from "../services/coins.js";
import { logCoinAward, logReferralEvent } from "../monitoring.js";
import { checkWin } from "../game/state.js";
import { validateGameMove, validateHelloMessage, sanitizeString } from "../validation.js";
import { buildTelegramName, sanitizeUsername } from "../common/sanitize.js";
import { parseStartPayload, buildLobbyInvitePayload } from "../common/startPayload.js";
import { validateTelegramInitData, extractUserData } from "../telegramAuth.js";
import { isNumericId } from "../common/id.js";
import { ensureRtSchema } from "./schema.js";

const MATCH_WIN_COIN_REWARD = Number(process.env.COIN_REWARD_MATCH_WIN || 100);
const ACHIEVEMENT_UNLOCK_COIN_REWARD = Number(process.env.COIN_REWARD_ACHIEVEMENT_UNLOCK || 50);
const REFERRAL_LINK_COIN_REWARD = Number(process.env.COIN_REWARD_REFERRAL_LINK || 75);

const ONLINE_WINDOW_SEC = 15; // кто считается «в сети» для счётчика онлайна
const OFFLINE_AFTER_SEC = 25; // после какого молчания оппонент считается отключившимся
const FAST_POLL_MS = 1200; // интервал поллинга в очереди/в игре
const SLOW_POLL_MS = 3500; // интервал поллинга в меню
const OUTBOX_BATCH = 100;
const INVITE_TTL_MS = 1000 * 60 * 30;
const INVITE_CODE_LENGTH = 10;
const REMATCH_DEDUPE_MS = 2500;
const DEFAULT_BOT_USERNAME = "TTToeONL_bot";

const nowSql = "NOW()";

const q = async (text, params = []) => {
  const pool = getPool();
  if (!pool) throw new Error("rt.db_unavailable");
  return pool.query(text, params);
};

const out = async (uid, payload, client = null) => {
  if (!uid) return;
  const sql = "INSERT INTO rt_outbox (uid, payload) VALUES ($1, $2::jsonb)";
  const params = [String(uid), JSON.stringify(payload)];
  if (client) await client.query(sql, params);
  else await q(sql, params);
};

const drainOutbox = async (uid) => {
  if (!uid) return [];
  const { rows } = await q(
    `DELETE FROM rt_outbox
     WHERE id IN (SELECT id FROM rt_outbox WHERE uid = $1 ORDER BY id ASC LIMIT ${OUTBOX_BATCH})
     RETURNING payload`,
    [String(uid)]
  );
  return rows.map((row) => row.payload);
};

const getSession = async (sid) => {
  if (!sid || typeof sid !== "string" || sid.length > 64) return null;
  const { rows } = await q(
    `UPDATE rt_sessions SET last_seen = ${nowSql} WHERE sid = $1
     RETURNING sid, uid, name, username, avatar, is_verified, last_opponent`,
    [sid]
  );
  return rows[0] || null;
};

const buildOnlineStatsMessage = async () => {
  const { rows } = await q(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE is_verified)::int AS verified
     FROM rt_sessions
     WHERE last_seen > ${nowSql} - INTERVAL '${ONLINE_WINDOW_SEC} seconds'`
  );
  const total = rows[0]?.total || 0;
  const verified = rows[0]?.verified || 0;
  return { t: "online.stats", total, verified, guest: Math.max(0, total - verified) };
};

const gameMeta = (g) => ({
  roundNumber: g.round_number,
  roundWinsX: g.round_wins_x,
  roundWinsO: g.round_wins_o,
  matchTargetWins: g.target_wins,
});

const buildOpponentPayload = async (uid) => {
  if (!uid) return null;
  const { rows } = await q(
    `SELECT name, username, avatar FROM rt_sessions WHERE uid = $1 ORDER BY last_seen DESC LIMIT 1`,
    [String(uid)]
  );
  const local = rows[0] || null;

  let name = sanitizeString(local?.name || "");
  let username = sanitizeUsername(local?.username || "");
  let avatar = (local?.avatar || "").trim();

  if ((!avatar || !username || !name) && isNumericId(uid)) {
    try {
      const profile = await getUserProfile(uid);
      if (profile) {
        if (!avatar && profile.avatar_url) avatar = String(profile.avatar_url);
        if (!username && profile.username) username = sanitizeUsername(profile.username);
        if (!name) name = sanitizeString(profile.username || "");
      }
    } catch (error) {
      console.error("buildOpponentPayload error:", error);
    }
  }

  const fallbackNameSource = name || (username ? `@${username}` : "Игрок");
  const finalName = sanitizeString(fallbackNameSource) || "Игрок";
  return { id: String(uid), name: finalName, username, avatar };
};

const getActiveUserProfile = async (uid) => {
  const { rows } = await q(
    `SELECT name, username, avatar FROM rt_sessions WHERE uid = $1 ORDER BY last_seen DESC LIMIT 1`,
    [String(uid)]
  );
  const row = rows[0];
  if (!row) return null;
  return { name: row.name || "", username: row.username || "", avatar_url: row.avatar || "" };
};

// --- Завершение матча: сообщения обоим игрокам + статистика/монеты/ачивки ---
const finishMatchSideEffects = async (game, reason, winBy) => {
  try {
    let unlockedByUser = {};
    if (winBy === "X" || winBy === "O") {
      const winnerUid = winBy === "X" ? game.x_uid : game.o_uid;
      const loserUid = winBy === "X" ? game.o_uid : game.x_uid;
      unlockedByUser = await recordMatchOutcome({
        winnerId: winnerUid,
        loserId: loserUid,
        profilesById: {
          [winnerUid]: await getActiveUserProfile(winnerUid),
          [loserUid]: await getActiveUserProfile(loserUid),
        },
      });
      const eventKey = `match:${game.id}:winner:${winnerUid}`;
      try {
        const awardResult = await awardCoins({
          userId: winnerUid,
          reason: COIN_REASONS.MATCH_WIN,
          amount: MATCH_WIN_COIN_REWARD,
          meta: { event_key: eventKey, source: "match_win", match_id: game.id, matchId: game.id },
        });
        logCoinAward({
          source: "match_win",
          eventKey,
          userId: winnerUid,
          reason: COIN_REASONS.MATCH_WIN,
          amount: MATCH_WIN_COIN_REWARD,
          result: awardResult.alreadyAwarded ? "already_awarded" : "awarded",
          meta: { matchId: game.id },
        });
      } catch (error) {
        logCoinAward({
          source: "match_win",
          eventKey,
          userId: winnerUid,
          reason: COIN_REASONS.MATCH_WIN,
          amount: MATCH_WIN_COIN_REWARD,
          result: "error",
          error,
          meta: { matchId: game.id },
        });
      }
    } else if (reason === "draw") {
      unlockedByUser = await recordMatchOutcome({
        drawIds: [game.x_uid, game.o_uid],
        profilesById: {
          [game.x_uid]: await getActiveUserProfile(game.x_uid),
          [game.o_uid]: await getActiveUserProfile(game.o_uid),
        },
      });
    }

    for (const [userId, achievementIds] of Object.entries(unlockedByUser || {})) {
      for (const achievementId of achievementIds || []) {
        const achievementEventKey = `achievement:${userId}:${achievementId}`;
        try {
          const awardResult = await awardCoins({
            userId,
            reason: COIN_REASONS.ACHIEVEMENT_UNLOCK,
            amount: ACHIEVEMENT_UNLOCK_COIN_REWARD,
            meta: {
              event_key: achievementEventKey,
              source: "achievement_unlock",
              achievement_id: achievementId,
              achievementId,
            },
          });
          logCoinAward({
            source: "achievement_unlock",
            eventKey: achievementEventKey,
            userId,
            reason: COIN_REASONS.ACHIEVEMENT_UNLOCK,
            amount: ACHIEVEMENT_UNLOCK_COIN_REWARD,
            result: awardResult.alreadyAwarded ? "already_awarded" : "awarded",
            meta: { achievementId },
          });
        } catch (error) {
          logCoinAward({
            source: "achievement_unlock",
            eventKey: achievementEventKey,
            userId,
            reason: COIN_REASONS.ACHIEVEMENT_UNLOCK,
            amount: ACHIEVEMENT_UNLOCK_COIN_REWARD,
            result: "error",
            error,
            meta: { achievementId },
          });
        }
      }
    }
  } catch (error) {
    console.error("recordMatchOutcome error:", error);
  }
};

// Завершает матч в рамках переданного client-транзакции (сообщения + удаление игры),
// возвращает данные для пост-обработки после COMMIT.
const finishMatchInTx = async (client, game, reason, winBy) => {
  const matchPayload = { t: "game.match_end", reason, by: winBy, ...gameMeta(game) };
  const legacyPayload = { t: "game.end", reason, by: winBy, ...gameMeta(game) };
  for (const uid of [game.x_uid, game.o_uid]) {
    await out(uid, matchPayload, client);
    await out(uid, legacyPayload, client);
  }
  await client.query("DELETE FROM rt_games WHERE id = $1", [game.id]);
};

const startGame = async (uidA, uidB) => {
  if (!uidA || !uidB || uidA === uidB) return;
  const gameId = `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const firstIsX = Math.random() < 0.5;
  const X = String(firstIsX ? uidA : uidB);
  const O = String(firstIsX ? uidB : uidA);

  await q(
    `INSERT INTO rt_games (id, x_uid, o_uid) VALUES ($1, $2, $3)`,
    [gameId, X, O]
  );
  await q(`UPDATE rt_sessions SET last_opponent = $2 WHERE uid = $1`, [X, O]);
  await q(`UPDATE rt_sessions SET last_opponent = $2 WHERE uid = $1`, [O, X]);

  const [oppForX, oppForO] = await Promise.all([buildOpponentPayload(O), buildOpponentPayload(X)]);
  const initialMeta = { roundWinsX: 0, roundWinsO: 0, roundNumber: 1, matchTargetWins: 3 };
  await out(X, { t: "game.start", gameId, you: "X", turn: "X", opp: oppForX, ...initialMeta });
  await out(O, { t: "game.start", gameId, you: "O", turn: "X", opp: oppForO, ...initialMeta });
  console.log(`[RT-GAME] ${gameId}: ${X} vs ${O}`);
};

// --- Матчмейкинг: берём двух самых давних из очереди под блокировкой ---
const attemptMatch = async () => {
  const pool = getPool();
  for (let round = 0; round < 5; round += 1) {
    const client = await pool.connect();
    let matched = null;
    let done = false;
    try {
      await client.query("BEGIN");
      const { rows: queued } = await client.query(
        `SELECT uid FROM rt_queue ORDER BY joined_at ASC, uid ASC LIMIT 2 FOR UPDATE SKIP LOCKED`
      );
      if (queued.length < 2) {
        await client.query("COMMIT");
        done = true;
      } else {
        const uids = queued.map((row) => row.uid);
        const { rows: fresh } = await client.query(
          `SELECT DISTINCT uid FROM rt_sessions
           WHERE uid = ANY($1) AND last_seen > ${nowSql} - INTERVAL '${OFFLINE_AFTER_SEC} seconds'`,
          [uids]
        );
        const freshSet = new Set(fresh.map((row) => row.uid));
        const stale = uids.filter((uid) => !freshSet.has(uid));
        if (stale.length > 0) {
          await client.query(`DELETE FROM rt_queue WHERE uid = ANY($1)`, [stale]);
          await client.query("COMMIT");
        } else {
          await client.query(`DELETE FROM rt_queue WHERE uid = ANY($1)`, [uids]);
          await out(uids[0], { t: "queue.left" }, client);
          await out(uids[1], { t: "queue.left" }, client);
          await client.query("COMMIT");
          matched = uids;
        }
      }
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
    if (matched) await startGame(matched[0], matched[1]);
    if (done) return;
  }
};

const queuePosition = async (uid) => {
  const { rows } = await q(
    `SELECT COUNT(*)::int AS position FROM rt_queue
     WHERE joined_at <= (SELECT joined_at FROM rt_queue WHERE uid = $1)`,
    [String(uid)]
  );
  return rows[0]?.position || 0;
};

// --- Игровой ход внутри транзакции ---
const handleGameMove = async (session, msg) => {
  if (!validateGameMove(msg)) return;
  const uid = session.uid;
  if (!uid) return;

  const pool = getPool();
  const client = await pool.connect();
  let finished = null;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT * FROM rt_games WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [msg.gameId]
    );
    const g = rows[0];
    const my = g ? (uid === g.x_uid ? "X" : uid === g.o_uid ? "O" : null) : null;
    const board = g && Array.isArray(g.board) ? g.board.slice() : Array(9).fill(null);
    if (!g || !my || g.turn !== my || board[msg.i]) {
      await client.query("ROLLBACK");
      return;
    }

    board[msg.i] = my;
    const nextTurn = my === "X" ? "O" : "X";
    const res = checkWin(board);

    if (!res) {
      await client.query(
        `UPDATE rt_games SET board = $2::jsonb, turn = $3, updated_at = ${nowSql} WHERE id = $1`,
        [g.id, JSON.stringify(board), nextTurn]
      );
      const statePayload = {
        t: "game.state",
        board,
        turn: nextTurn,
        win: null,
        ...gameMeta(g),
      };
      await out(g.x_uid, statePayload, client);
      await out(g.o_uid, statePayload, client);
      await client.query("COMMIT");
      return;
    }

    // Раунд закончился: победа или ничья
    const winBy = res.by; // "X" | "O" | null (ничья)
    if (winBy === "X") g.round_wins_x += 1;
    if (winBy === "O") g.round_wins_o += 1;

    const roundPayload = {
      t: "game.round_end",
      reason: winBy ? "win" : "draw",
      by: winBy,
      line: res.line || null,
      ...gameMeta(g),
    };
    await out(g.x_uid, roundPayload, client);
    await out(g.o_uid, roundPayload, client);

    const target = Number(g.target_wins || 3);
    if (g.round_wins_x >= target || g.round_wins_o >= target) {
      const matchWinBy = g.round_wins_x >= target ? "X" : "O";
      await finishMatchInTx(client, g, "win", matchWinBy);
      finished = { game: g, reason: "win", winBy: matchWinBy };
    } else {
      g.round_number += 1;
      await client.query(
        `UPDATE rt_games
         SET board = '[null,null,null,null,null,null,null,null,null]'::jsonb,
             turn = 'X',
             round_wins_x = $2, round_wins_o = $3, round_number = $4,
             updated_at = ${nowSql}
         WHERE id = $1`,
        [g.id, g.round_wins_x, g.round_wins_o, g.round_number]
      );
      const statePayload = {
        t: "game.state",
        board: Array(9).fill(null),
        turn: "X",
        win: null,
        ...gameMeta(g),
      };
      await out(g.x_uid, statePayload, client);
      await out(g.o_uid, statePayload, client);
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
  if (finished) await finishMatchSideEffects(finished.game, finished.reason, finished.winBy);
};

// Общий путь завершения матча по внешней причине (сдача, дисконнект)
const endMatchByReason = async (gameId, reason, winBy) => {
  const pool = getPool();
  const client = await pool.connect();
  let finished = null;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT * FROM rt_games WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [gameId]
    );
    const g = rows[0];
    if (g) {
      await finishMatchInTx(client, g, reason, winBy);
      finished = { game: g, reason, winBy };
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
  if (finished) await finishMatchSideEffects(finished.game, finished.reason, finished.winBy);
};

const handleGameResign = async (session, msg) => {
  const uid = session.uid;
  const gameId = typeof msg?.gameId === "string" ? msg.gameId : "";
  if (!uid || !gameId) return;
  const { rows } = await q(`SELECT * FROM rt_games WHERE id = $1 AND status = 'active'`, [gameId]);
  const g = rows[0];
  if (!g) return;
  let winBy = null;
  if (uid === g.x_uid) winBy = "O";
  else if (uid === g.o_uid) winBy = "X";
  else return;
  await endMatchByReason(gameId, "resign", winBy);
};

// Проверка «оппонент отключился» — вызывается на каждом poll игрока в активной игре
const checkOpponentTimeout = async (uid) => {
  const { rows: games } = await q(
    `SELECT * FROM rt_games WHERE status = 'active' AND (x_uid = $1 OR o_uid = $1)`,
    [String(uid)]
  );
  for (const g of games) {
    const oppUid = g.x_uid === uid ? g.o_uid : g.x_uid;
    const { rows } = await q(
      `SELECT 1 FROM rt_sessions
       WHERE uid = $1 AND last_seen > ${nowSql} - INTERVAL '${OFFLINE_AFTER_SEC} seconds'
       LIMIT 1`,
      [String(oppUid)]
    );
    if (rows.length === 0) {
      const winBy = g.x_uid === uid ? "X" : "O";
      await endMatchByReason(g.id, "disconnect", winBy);
    }
  }
};

// --- hello: авторизация Telegram + рефералка (порт server/ws/handlers/hello.js) ---
const handleHello = async (session, msg) => {
  if (!validateHelloMessage(msg)) return;

  const uid = String(msg.uid);
  const name = sanitizeString(msg.name || "Player");
  const avatar = (msg.avatar || "").slice(0, 500);
  const initData = typeof msg.initData === "string" ? msg.initData : "";
  const usernameHint = sanitizeUsername(msg.username);

  let profile = { id: uid, name, username: usernameHint, avatar, isVerified: false };

  const startPayloadCandidates = [];
  if (typeof msg.startParam === "string") startPayloadCandidates.push(msg.startParam);
  let parsedStartPayload = { kind: "none", raw: "" };
  let inviterRefCode = null;

  if (initData) {
    const initDataValidation = validateTelegramInitData(initData);
    if (initDataValidation.isValid) {
      const userData = extractUserData(initData, { skipValidation: true });
      if (userData && String(userData.id) === uid) {
        profile = {
          id: uid,
          name: buildTelegramName(userData),
          username: (userData.username || "").trim(),
          avatar: userData.photo_url || "",
          isVerified: true,
        };
      }
      const params = new URLSearchParams(initData);
      startPayloadCandidates.push(params.get("start_param") || "");
    } else if (initDataValidation.reason === "expired") {
      console.warn(`[RT-HELLO] expired initData uid=${uid} age_sec=${initDataValidation.ageSec}`);
    }
  }

  for (const candidate of startPayloadCandidates) {
    const parsed = parseStartPayload(candidate);
    if (parsed.kind === "none") continue;
    parsedStartPayload = parsed;
    if (parsed.kind === "referral" && !inviterRefCode) inviterRefCode = parsed.refCode;
    if (parsed.kind === "referral" || parsed.kind === "lobby_invite") break;
  }

  if (parsedStartPayload.kind === "referral") {
    logReferralEvent("referral_link_opened", {
      userId: uid,
      verifiedSession: profile.isVerified,
      meta: { refPayload: parsedStartPayload.raw, refCode: parsedStartPayload.refCode },
    });
  }

  if (!profile.isVerified && parsedStartPayload.kind === "referral") {
    logReferralEvent("referral_rejected_reason", {
      userId: uid,
      reason: "unverified_session",
      meta: { refPayload: parsedStartPayload.raw, refCode: parsedStartPayload.refCode },
    });
    inviterRefCode = null;
  }

  // Одна активная сессия на uid: старые вытесняются
  await q(`DELETE FROM rt_sessions WHERE uid = $1 AND sid <> $2`, [uid, session.sid]);
  await q(
    `UPDATE rt_sessions
     SET uid = $2, name = $3, username = $4, avatar = $5, is_verified = $6, last_seen = ${nowSql}
     WHERE sid = $1`,
    [session.sid, uid, profile.name, profile.username, profile.avatar, profile.isVerified]
  );
  console.log(`[RT-HELLO] uid=${uid} name="${profile.name}" verified=${profile.isVerified}`);

  try {
    if (/^[0-9]+$/.test(uid)) {
      const registrationSource = profile.isVerified ? "telegram_init_data" : null;
      const registrationPayload =
        profile.isVerified && parsedStartPayload.kind !== "none" ? parsedStartPayload.raw : null;
      await upsertUser({
        id: uid,
        username: profile.username || profile.name,
        avatar_url: profile.avatar,
        registrationSource,
        registrationPayload,
      });
      if (inviterRefCode) {
        const referralResult = await bindReferral({ inviterRefCode, invitedId: uid });
        if (referralResult.linked) {
          const inviterId = referralResult.inviterId;
          const invitedId = referralResult.invitedId;
          const eventKey = `referral:${inviterId}:${invitedId}`;
          const referralMeta = {
            refPayload: parsedStartPayload.raw,
            refCode: inviterRefCode,
            invitedId,
          };
          logReferralEvent("referral_bound", { userId: uid, inviterId, invitedId, meta: referralMeta });
          try {
            const awardResult = await awardCoins({
              userId: inviterId,
              reason: COIN_REASONS.REFERRAL_SIGNUP,
              amount: REFERRAL_LINK_COIN_REWARD,
              meta: {
                event_key: eventKey,
                source: "referral_link",
                invited_id: invitedId,
                ref_payload: parsedStartPayload.raw,
              },
            });
            logCoinAward({
              source: "referral_link",
              eventKey,
              userId: inviterId,
              reason: COIN_REASONS.REFERRAL_SIGNUP,
              amount: REFERRAL_LINK_COIN_REWARD,
              result: awardResult.alreadyAwarded ? "already_awarded" : "awarded",
              meta: referralMeta,
            });
          } catch (error) {
            logCoinAward({
              source: "referral_link",
              eventKey,
              userId: inviterId,
              reason: COIN_REASONS.REFERRAL_SIGNUP,
              amount: REFERRAL_LINK_COIN_REWARD,
              result: "error",
              error,
              meta: referralMeta,
            });
          }
        } else {
          logReferralEvent("referral_rejected_reason", {
            userId: uid,
            reason: referralResult.reason || "unknown",
            meta: { refPayload: parsedStartPayload.raw, refCode: inviterRefCode },
          });
        }
      }
    }
  } catch (error) {
    console.error("rt hello db error:", error);
  }
};

// --- Очередь ---
const handleQueueJoin = async (session) => {
  const uid = session.uid;
  if (!uid) return;
  const { rowCount } = await q(
    `INSERT INTO rt_queue (uid) VALUES ($1) ON CONFLICT (uid) DO NOTHING`,
    [uid]
  );
  if (rowCount > 0) await out(uid, { t: "queue.joined" });
  const position = await queuePosition(uid);
  if (position > 0) await out(uid, { t: "queue.waiting", position });
  await attemptMatch();
};

const handleQueueLeave = async (session) => {
  const uid = session.uid;
  if (!uid) return;
  const { rowCount } = await q(`DELETE FROM rt_queue WHERE uid = $1`, [uid]);
  if (rowCount > 0) await out(uid, { t: "queue.left" });
};

// --- Приглашения (порт server/ws/handlers/invite.js + server/game/invites.js) ---
const buildInviteLink = (code) => {
  const botUsername = String(
    process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || DEFAULT_BOT_USERNAME
  ).trim();
  const payload = encodeURIComponent(buildLobbyInvitePayload(code));
  return `https://t.me/${botUsername}/play?startapp=${payload}`;
};

const createInviteRecord = async (hostUserId) => {
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  for (let i = 0; i < 5; i += 1) {
    const code = crypto.randomBytes(8).toString("base64url").slice(0, INVITE_CODE_LENGTH);
    const invite = await createInvite({ code, hostUserId, expiresAt });
    if (invite) return invite;
  }
  return null;
};

const handleInviteCreate = async (session) => {
  const uid = session.uid;
  if (!uid) return;
  try {
    const pending = await getPendingInviteByHost(uid);
    const validPending =
      pending && new Date(pending.expires_at).getTime() > Date.now() ? pending : null;
    const invite = validPending || (await createInviteRecord(uid));
    if (!invite) {
      await out(uid, { t: "invite.invalid", reason: "create_failed" });
      return;
    }
    await out(uid, {
      t: "invite.created",
      code: invite.code,
      link: buildInviteLink(invite.code),
      expiresAt: invite.expires_at,
    });
    await out(uid, { t: "invite.waiting", code: invite.code });
  } catch (error) {
    console.error("rt invite_create error:", error);
    await out(uid, { t: "invite.invalid", reason: "create_failed" });
  }
};

const handleInviteAccept = async (session, msg) => {
  const code = typeof msg.code === "string" ? msg.code.trim() : "";
  const guestId = session.uid;
  if (!code || !guestId) return;

  try {
    const invite = await getInvite(code);
    if (!invite) {
      await out(guestId, { t: "invite.invalid", reason: "not_found" });
      return;
    }
    if (invite.status !== "pending") {
      await out(guestId, { t: "invite.invalid", reason: "used" });
      return;
    }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      await expireInvite(code);
      await out(guestId, { t: "invite.invalid", reason: "expired" });
      return;
    }
    if (String(invite.host_user_id) === String(guestId)) {
      await out(guestId, { t: "invite.invalid", reason: "self" });
      return;
    }

    const hostUid = String(invite.host_user_id);
    const { rows: hostAlive } = await q(
      `SELECT 1 FROM rt_sessions
       WHERE uid = $1 AND last_seen > ${nowSql} - INTERVAL '${OFFLINE_AFTER_SEC} seconds'
       LIMIT 1`,
      [hostUid]
    );
    if (hostAlive.length === 0) {
      await out(guestId, { t: "invite.invalid", reason: "host_offline" });
      return;
    }

    const accepted = await acceptInvite({ code, guestUserId: guestId });
    if (!accepted) {
      await out(guestId, { t: "invite.invalid", reason: "used" });
      return;
    }

    await q(`DELETE FROM rt_queue WHERE uid = ANY($1)`, [[hostUid, String(guestId)]]);
    await out(hostUid, { t: "invite.connected", code, guest: guestId });
    await out(guestId, { t: "invite.connected", code, host: hostUid });
    await startGame(hostUid, String(guestId));
  } catch (error) {
    console.error("rt invite_accept error:", error);
    await out(guestId, { t: "invite.invalid", reason: "server_error" });
  }
};

// --- Реванш ---
const handleRematchOffer = async (session) => {
  const uid = session.uid;
  const opp = session.last_opponent;
  if (!uid || !opp) return;
  await out(opp, {
    t: "rematch.offer",
    from: {
      id: uid,
      name: session.name,
      username: session.username || "",
      avatar: session.avatar,
    },
  });
};

const handleRematchAccept = async (session) => {
  const uid = session.uid;
  const opp = session.last_opponent;
  if (!uid || !opp || uid === opp) return;

  const pairKey = [String(uid), String(opp)].sort().join(":");
  await q(`DELETE FROM rt_rematch WHERE expires_at <= ${nowSql}`);
  const { rowCount } = await q(
    `INSERT INTO rt_rematch (pair_key, expires_at)
     VALUES ($1, ${nowSql} + INTERVAL '${Math.round(REMATCH_DEDUPE_MS / 1000)} seconds')
     ON CONFLICT (pair_key) DO NOTHING`,
    [pairKey]
  );
  if (rowCount === 0) return; // второй игрок уже запустил игру
  await startGame(uid, opp);
};

const handleRematchDecline = async (session) => {
  const uid = session.uid;
  const opp = session.last_opponent;
  if (!uid || !opp) return;
  await out(opp, { t: "rematch.declined", by: uid });
  await out(uid, { t: "rematch.declined", by: uid });
};

const handlers = {
  hello: handleHello,
  queue_join: handleQueueJoin,
  queue_leave: handleQueueLeave,
  game_move: handleGameMove,
  game_resign: handleGameResign,
  invite_create: handleInviteCreate,
  invite_accept: handleInviteAccept,
  rematch_offer: handleRematchOffer,
  rematch_accept: handleRematchAccept,
  rematch_decline: handleRematchDecline,
};

const maybeCleanup = async () => {
  if (Math.random() > 0.05) return;
  try {
    await q(`DELETE FROM rt_sessions WHERE last_seen < ${nowSql} - INTERVAL '10 minutes'`);
    await q(`DELETE FROM rt_outbox WHERE created_at < ${nowSql} - INTERVAL '5 minutes'`);
    await q(`DELETE FROM rt_games WHERE updated_at < ${nowSql} - INTERVAL '30 minutes'`);
    await q(
      `DELETE FROM rt_queue WHERE uid NOT IN (
         SELECT uid FROM rt_sessions
         WHERE uid IS NOT NULL AND last_seen > ${nowSql} - INTERVAL '${OFFLINE_AFTER_SEC} seconds'
       )`
    );
    await q(`DELETE FROM rt_rematch WHERE expires_at <= ${nowSql}`);
  } catch (error) {
    console.error("rt cleanup error:", error);
  }
};

const pollIntervalFor = async (uid) => {
  if (!uid) return SLOW_POLL_MS;
  const { rows } = await q(
    `SELECT 1 WHERE EXISTS (SELECT 1 FROM rt_queue WHERE uid = $1)
        OR EXISTS (SELECT 1 FROM rt_games WHERE status = 'active' AND (x_uid = $1 OR o_uid = $1))`,
    [String(uid)]
  );
  return rows.length > 0 ? FAST_POLL_MS : SLOW_POLL_MS;
};

// ===== Публичный API движка =====

export const rtConnect = async () => {
  await ensureRtSchema();
  const sid = crypto.randomUUID();
  await q(`INSERT INTO rt_sessions (sid) VALUES ($1)`, [sid]);
  const stats = await buildOnlineStatsMessage();
  return { ok: true, sid, interval: SLOW_POLL_MS, messages: [stats] };
};

export const rtSend = async (sid, msg) => {
  await ensureRtSchema();
  const session = await getSession(sid);
  if (!session) return { ok: false, gone: true };
  if (!msg || typeof msg !== "object") return { ok: false };

  const t = String(msg.t || "").replace(/\./g, "_");
  const handler = handlers[t];
  if (typeof handler === "function") {
    try {
      await handler(session, msg);
    } catch (error) {
      console.error(`rt handler error (${t}):`, error);
    }
  }

  // Обновлённый uid после hello
  const uid = t === "hello" ? String(msg.uid || session.uid || "") : session.uid;
  const messages = await drainOutbox(uid);
  return { ok: true, messages, interval: await pollIntervalFor(uid) };
};

export const rtPoll = async (sid) => {
  await ensureRtSchema();
  const session = await getSession(sid);
  if (!session) return { ok: false, gone: true };

  const uid = session.uid;
  if (uid) {
    const { rows: queued } = await q(`SELECT 1 FROM rt_queue WHERE uid = $1`, [uid]);
    if (queued.length > 0) await attemptMatch();
    await checkOpponentTimeout(uid);
  }
  await maybeCleanup();

  const messages = await drainOutbox(uid);
  messages.push(await buildOnlineStatsMessage());
  return { ok: true, messages, interval: await pollIntervalFor(uid) };
};
