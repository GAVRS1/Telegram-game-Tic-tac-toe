import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import "dotenv/config";
import { WebSocketServer } from "ws";
import { Telegraf } from "telegraf";
import { validateTelegramWebAppData, extractUserData } from "./telegramAuth.js";
import { loggingMiddleware } from "./monitoring.js";
import { validateGameMove, validateHelloMessage, sanitizeString } from "./validation.js";
import {
  ensureSchema,
  upsertUser,
  recordMatchOutcome,
  getLeaders,
  getUserProfile,
  createInvite,
  getInvite,
  getPendingInviteByHost,
  acceptInvite,
  expireInvite,
} from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const SKIP_BOT = process.env.SKIP_BOT === "1";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").trim();

const app = express();
app.set("trust proxy", 1);
const PUBLIC_DIR = path.resolve(__dirname, "..", "client", "dist");

app.use(express.json({ limit: "100kb" }));
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", "data:", "https:", "blob:"],
      "script-src": ["'self'", "https://telegram.org"],
      "script-src-attr": ["'unsafe-inline'"],
      "connect-src": ["'self'", "ws:", "wss:", "https:"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "media-src": ["'self'", "data:"]
    }
  }
}));
app.use(cors({ origin: false }));
app.use(loggingMiddleware);
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

app.use((req, _res, next) => { console.log(`[HTTP] ${req.method} ${req.url}`); next(); });
app.get("/config.json", (req, res) => {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host  = req.headers["x-forwarded-host"]  || req.headers.host || `localhost:${PORT}`;
  const origin = `${proto}://${host}`;
  const webAppUrl = PUBLIC_URL || origin.replace(/^http:/, "https:");
  const wsUrl     = (PUBLIC_URL || origin).replace(/^http/, "ws");
  res.json({ webAppUrl, wsUrl });
});

app.use(express.static(PUBLIC_DIR));

app.get("/leaders", async (_req, res) => {
  try {
    const list = await getLeaders(20);
    res.json({ ok: true, leaders: list });
  } catch (e) {
    console.error("leaders error:", e);
    res.status(500).json({ ok: false });
  }
});

app.get("/profile/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9]+$/.test(String(id || ""))) {
      return res.status(400).json({ ok: false, error: "invalid id" });
    }
    const profile = await getUserProfile(id);
    res.json({ ok: true, profile });
  } catch (e) {
    console.error("profile error:", e);
    res.status(500).json({ ok: false });
  }
});

const INVITE_TTL_MS = 1000 * 60 * 30;
const INVITE_CODE_LENGTH = 10;
const inviteByCode = new Map();
const inviteCodeByHost = new Map();

const generateInviteCode = () =>
  crypto.randomBytes(8).toString("base64url").slice(0, INVITE_CODE_LENGTH);

const buildInviteLink = (req, code) => {
  if (!req) {
    const origin = PUBLIC_URL || `http://localhost:${PORT}`;
    const base = origin.replace(/\/$/, "");
    return `${base}/?ref=${encodeURIComponent(code)}`;
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  const origin = PUBLIC_URL || `${proto}://${host}`;
  const base = origin.replace(/\/$/, "");
  return `${base}/?ref=${encodeURIComponent(code)}`;
};

const createInviteRecord = async (hostUserId) => {
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  for (let i = 0; i < 5; i += 1) {
    const code = generateInviteCode();
    const invite = await createInvite({ code, hostUserId, expiresAt });
    if (invite) return invite;
  }
  return null;
};

const cacheInvite = (invite) => {
  if (!invite?.code || !invite?.host_user_id) return;
  const normalized = {
    ...invite,
    code: String(invite.code),
    host_user_id: String(invite.host_user_id),
  };
  inviteByCode.set(normalized.code, normalized);
  inviteCodeByHost.set(normalized.host_user_id, normalized.code);
};

const dropInviteCache = (code, hostUserId = null) => {
  if (code) {
    const existing = inviteByCode.get(code);
    if (existing?.host_user_id) inviteCodeByHost.delete(existing.host_user_id);
    inviteByCode.delete(code);
  }
  if (hostUserId) inviteCodeByHost.delete(String(hostUserId));
};

const isInviteExpired = (invite) => {
  const expiresAt = new Date(invite?.expires_at || 0).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
};

const getValidInviteByHost = async (hostUserId) => {
  const host = String(hostUserId || "");
  if (!host) return null;

  const cachedCode = inviteCodeByHost.get(host);
  if (cachedCode) {
    const cachedInvite = inviteByCode.get(cachedCode);
    if (cachedInvite && cachedInvite.status === "pending" && !isInviteExpired(cachedInvite)) {
      return cachedInvite;
    }
    dropInviteCache(cachedCode, host);
  }

  const dbInvite = await getPendingInviteByHost(host);
  if (dbInvite) {
    cacheInvite(dbInvite);
    return dbInvite;
  }
  return null;
};

app.post("/invite", async (req, res) => {
  try {
    const hostUserId = String(req.body?.host_user_id || req.body?.hostUserId || "").trim();
    if (!hostUserId) {
      return res.status(400).json({ ok: false, error: "host_user_id required" });
    }
    await ensureSchema();
    const invite = (await getValidInviteByHost(hostUserId)) || (await createInviteRecord(hostUserId));
    if (!invite) {
      return res.status(500).json({ ok: false, error: "invite creation failed" });
    }
    cacheInvite(invite);
    const link = buildInviteLink(req, invite.code);
    res.json({ ok: true, code: invite.code, link, expiresAt: invite.expires_at });
  } catch (e) {
    console.error("invite create error:", e);
    res.status(500).json({ ok: false });
  }
});

app.get("*", (req, res, next) => {
  if (req.path === "/config.json") return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server });

const wsByUid = new Map();
const userByWs = new Map();

const games = new Map();
const queueByUid = new Map();
const queueOrder = [];
let queueHead = 0;
const lastQueueJoinByUid = new Map();

const QUEUE_JOIN_THROTTLE_MS = 3000;

const buildTelegramName = (user) => {
  if (!user) return 'Player';
  const first = (user.first_name || '').trim();
  const last = (user.last_name || '').trim();
  const username = (user.username || '').trim();
  const combined = `${first} ${last}`.trim();
  return sanitizeString(combined || username || 'Player');
};

const sanitizeUsername = (value) => {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
};

const send = (ws, obj) => { try { ws?.readyState === 1 && ws.send(JSON.stringify(obj)); } catch {} };
const toWs = (uid) => wsByUid.get(uid);
const inQueue = (uid) => queueByUid.has(uid);
const buildOnlineStats = () => {
  const total = wss.clients.size;
  let verified = 0;
  let unverified = 0;
  userByWs.forEach((user, ws) => {
    if (!wss.clients.has(ws)) return;
    if (user?.isVerified) verified += 1;
    else unverified += 1;
  });
  const anonymous = Math.max(0, total - (verified + unverified));
  const guest = unverified + anonymous;
  return { total, verified, guest };
};

const broadcastOnlineStats = () => {
  const stats = buildOnlineStats();
  const payload = { t: "online.stats", ...stats };
  wss.clients.forEach((ws) => send(ws, payload));
};

const removeFromQueue = (uid) => {
  if (!uid) return;
  queueByUid.delete(uid);
};

const recordQueueJoin = (uid, ws) => {
  if (queueByUid.has(uid)) return false;
  const entry = { ws, ts: Date.now() };
  queueByUid.set(uid, entry);
  queueOrder.push(uid);
  return true;
};

const findNextQueuedUid = (startIndex, skipUid = null) => {
  for (let i = startIndex; i < queueOrder.length; i += 1) {
    const uid = queueOrder[i];
    if (!queueByUid.has(uid)) continue;
    if (skipUid && uid === skipUid) continue;
    return { uid, index: i };
  }
  return null;
};

const sendQueueWaiting = (uid) => {
  const ws = toWs(uid);
  if (!ws) return;
  let position = 0;
  for (let i = queueHead; i < queueOrder.length; i += 1) {
    const queuedUid = queueOrder[i];
    if (!queueByUid.has(queuedUid)) continue;
    position += 1;
    if (queuedUid === uid) break;
  }
  send(ws, { t: "queue.waiting", position });
};

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const checkWin = (board) => {
  for (const [a,b,c] of LINES) if (board[a] && board[a]===board[b] && board[a]===board[c]) return { by: board[a], line:[a,b,c] };
  if (board.every(Boolean)) return { by: null, line:null };
  return null;
};

const broadcastState = (gameId) => {
  const g = games.get(gameId); if (!g) return;
  const payload = { t:"game.state", board:g.board, turn:g.turn, win:checkWin(g.board) };
  send(toWs(g.X), payload);
  send(toWs(g.O), payload);
};

function isNumericId(id){ return typeof id==='string' ? /^[0-9]+$/.test(id) : Number.isFinite(id); }

const endGame = async (gameId, reason="end", winBy=null) => {
  const g = games.get(gameId); if (!g) return;
  send(toWs(g.X), { t:"game.end", reason, by: winBy });
  send(toWs(g.O), { t:"game.end", reason, by: winBy });

  try {
    if (winBy === "X" || winBy === "O") {
      const winnerUid = winBy === "X" ? g.X : g.O;
      const loserUid = winBy === "X" ? g.O : g.X;
      await recordMatchOutcome({ winnerId: winnerUid, loserId: loserUid });
    } else if (reason === "draw") {
      await recordMatchOutcome({ drawIds: [g.X, g.O] });
    }
  } catch (e) {
    console.error("recordMatchOutcome error:", e);
  }

  games.delete(gameId);
};

async function buildOpponentPayload(uid) {
  if (!uid) return null;

  const ws = toWs(uid);
  const local = ws ? userByWs.get(ws) : null;

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
    } catch (e) {
      console.error("buildOpponentPayload error:", e);
    }
  }

  const fallbackNameSource = name || (username ? `@${username}` : "Игрок");
  const finalName = sanitizeString(fallbackNameSource) || "Игрок";

  if (local) {
    local.name = finalName;
    local.username = username;
    if (avatar) local.avatar = avatar;
  }

  return {
    id: uid,
    name: finalName,
    username,
    avatar,
  };
}

const startGame = async (uidA, uidB) => {
  if (!uidA || !uidB || uidA === uidB) return;

  const gameId = "g_" + Date.now() + "_" + Math.random().toString(36).slice(2);
  const firstIsX = Math.random() < 0.5;
  const X = firstIsX ? uidA : uidB;
  const O = firstIsX ? uidB : uidA;
  games.set(gameId, { X, O, board:Array(9).fill(null), turn:"X" });

  const a = userByWs.get(toWs(uidA));
  const b = userByWs.get(toWs(uidB));
  if (a) a.lastOpponent = uidB;
  if (b) b.lastOpponent = uidA;

  const [oppForX, oppForO] = await Promise.all([
    buildOpponentPayload(O),
    buildOpponentPayload(X),
  ]);

  send(toWs(X), { t:"game.start", gameId, you:"X", turn:"X", opp: oppForX });
  send(toWs(O), { t:"game.start", gameId, you:"O", turn:"X", opp: oppForO });

  console.log(`[GAME] ${gameId}: ${a?.name||X} vs ${b?.name||O}`);
};

const dropFromQueue = (uid) => {
  if (!uid) return;
  if (!inQueue(uid)) return;
  removeFromQueue(uid);
  send(toWs(uid), { t: "queue.left" });
};

const matchmake = () => {
  let searchIndex = queueHead;
  while (true) {
    const first = findNextQueuedUid(searchIndex);
    if (!first) {
      queueHead = queueOrder.length;
      return;
    }
    const second = findNextQueuedUid(first.index + 1, first.uid);
    if (!second) {
      queueHead = first.index;
      sendQueueWaiting(first.uid);
      return;
    }

    removeFromQueue(first.uid);
    removeFromQueue(second.uid);
    queueHead = second.index + 1;

    send(toWs(first.uid), { t: "queue.left" });
    send(toWs(second.uid), { t: "queue.left" });

    if (first.uid !== second.uid) {
      startGame(first.uid, second.uid).catch((e) => console.error("startGame error:", e));
    }

    searchIndex = queueHead;
  }
};

// Heartbeat
const HEARTBEAT = 30000;
function heartbeat() { this.isAlive = true; }
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(() => {}); } catch {}
  });
}, HEARTBEAT);
const ONLINE_STATS_INTERVAL_MS = 7000;
const onlineStatsInterval = setInterval(broadcastOnlineStats, ONLINE_STATS_INTERVAL_MS);
wss.on("close", () => {
  clearInterval(interval);
  clearInterval(onlineStatsInterval);
});

const handlers = {
  async hello(ws, msg) {
    if (!validateHelloMessage(msg)) return;

    const uid = String(msg.uid);
    const name = sanitizeString(msg.name || 'Player');
    const avatar = (msg.avatar || '').slice(0, 500);
    const initData = typeof msg.initData === 'string' ? msg.initData : '';
    const usernameHint = sanitizeUsername(msg.username);

    let profile = { id: uid, name, username: usernameHint, avatar, isVerified: false, source: 'fallback' };

    if (initData && validateTelegramWebAppData(initData)) {
      const userData = extractUserData(initData);
      if (userData && String(userData.id) === uid) {
        profile = {
          id: uid,
          name: buildTelegramName(userData),
          username: (userData.username || '').trim(),
          avatar: userData.photo_url || '',
          isVerified: true,
          source: 'telegram'
        };
      }
    }

    const prev = wsByUid.get(uid);
    if (prev && prev !== ws) { try { prev.close(); } catch {} }

    wsByUid.set(uid, ws);
    userByWs.set(ws, {
      id: profile.id,
      name: profile.name,
      username: profile.username,
      avatar: profile.avatar,
      lastOpponent: null,
      isVerified: profile.isVerified,
    });

    console.log(`[HELLO] uid=${uid} name="${profile.name}" verified=${profile.isVerified} src=${profile.source}`);
    broadcastOnlineStats();

    try {
      await ensureSchema();
      if (/^[0-9]+$/.test(uid)) {
        const usernameForDb = profile.username || profile.name;
        await upsertUser({ id: uid, username: usernameForDb, avatar_url: profile.avatar });
      }
    } catch {}
  },

  async invite_create(ws) {
    const uid = userByWs.get(ws)?.id;
    if (!uid) return;
    try {
      await ensureSchema();
      const reusable = await getValidInviteByHost(uid);
      const invite = reusable || (await createInviteRecord(uid));
      if (!invite) {
        send(ws, { t: "invite.invalid", reason: "create_failed" });
        return;
      }
      cacheInvite(invite);
      const link = buildInviteLink(null, invite.code);
      send(ws, { t: "invite.created", code: invite.code, link, expiresAt: invite.expires_at });
      send(ws, { t: "invite.waiting", code: invite.code });
    } catch (e) {
      console.error("invite_create error:", e);
      send(ws, { t: "invite.invalid", reason: "create_failed" });
    }
  },

  async invite_accept(ws, msg) {
    const code = typeof msg.code === "string" ? msg.code.trim() : "";
    const guestId = userByWs.get(ws)?.id;
    if (!code || !guestId) return;

    try {
      await ensureSchema();
      const cachedInvite = inviteByCode.get(code);
      const invite = cachedInvite || (await getInvite(code));
      if (!invite) {
        send(ws, { t: "invite.invalid", reason: "not_found" });
        return;
      }
      if (!cachedInvite) cacheInvite(invite);
      if (invite.status !== "pending") {
        dropInviteCache(code, invite.host_user_id);
        send(ws, { t: "invite.invalid", reason: "used" });
        return;
      }
      if (new Date(invite.expires_at).getTime() <= Date.now()) {
        await expireInvite(code);
        dropInviteCache(code, invite.host_user_id);
        send(ws, { t: "invite.invalid", reason: "expired" });
        return;
      }
      if (String(invite.host_user_id) === String(guestId)) {
        send(ws, { t: "invite.invalid", reason: "self" });
        return;
      }

      const hostWs = wsByUid.get(String(invite.host_user_id));
      if (!hostWs) {
        send(ws, { t: "invite.invalid", reason: "host_offline" });
        return;
      }

      const accepted = await acceptInvite({ code, guestUserId: guestId });
      if (!accepted) {
        dropInviteCache(code, invite.host_user_id);
        send(ws, { t: "invite.invalid", reason: "used" });
        return;
      }
      dropInviteCache(code, accepted.host_user_id);

      dropFromQueue(accepted.host_user_id);
      dropFromQueue(guestId);

      send(hostWs, { t: "invite.connected", code, guest: guestId });
      send(ws, { t: "invite.connected", code, host: accepted.host_user_id });

      startGame(String(accepted.host_user_id), String(guestId)).catch((e) =>
        console.error("startGame error:", e)
      );
    } catch (e) {
      console.error("invite_accept error:", e);
      send(ws, { t: "invite.invalid", reason: "server_error" });
    }
  },

  queue_join(ws) {
    const uid = userByWs.get(ws)?.id;
    if (!uid) return;

    const now = Date.now();
    const lastJoin = lastQueueJoinByUid.get(uid) || 0;
    if (now - lastJoin < QUEUE_JOIN_THROTTLE_MS) {
      const retryIn = QUEUE_JOIN_THROTTLE_MS - (now - lastJoin);
      send(ws, { t: "queue.throttled", retryIn });
      sendQueueWaiting(uid);
      return;
    }
    lastQueueJoinByUid.set(uid, now);

    const added = recordQueueJoin(uid, ws);
    if (added) {
      send(ws, { t: "queue.joined" });
    }
    sendQueueWaiting(uid);
    matchmake();
  },

  queue_leave(ws) {
    const uid = userByWs.get(ws)?.id;
    if (!uid) return;
    if (inQueue(uid)) {
      removeFromQueue(uid);
      send(ws, { t: "queue.left" });
    }
  },

  game_move(ws, msg) {
    if (!validateGameMove(msg)) return;
    const { gameId, i } = msg;
    const g = games.get(gameId); if (!g) return;
    const me = userByWs.get(ws)?.id; if (!me) return;
    const my = me===g.X ? "X" : me===g.O ? "O" : null;
    if (!my || g.turn !== my) return;
    if (g.board[i]) return;

    g.board[i] = my;
    g.turn = my === "X" ? "O" : "X";
    const res = checkWin(g.board);
    broadcastState(gameId);
    if (res) return endGame(gameId, res.by===null ? "draw" : "win", res.by);
  },

  game_resign(ws, msg) {
    const { gameId } = msg || {};
    const g = games.get(gameId);
    if (!g) return;
    const me = userByWs.get(ws)?.id;
    if (!me) return;
    let winBy = null;
    if (me === g.X) winBy = "O";
    else if (me === g.O) winBy = "X";
    endGame(gameId, "resign", winBy);
  },

  rematch_offer(ws) {
    const me = userByWs.get(ws);
    if (!me?.lastOpponent) return;
    const oppWs = wsByUid.get(me.lastOpponent);
    if (oppWs) {
      const from = { id: me.id, name: me.name, username: me.username || '', avatar: me.avatar };
      send(oppWs, { t:"rematch.offer", from });
    }
  },

  rematch_accept(ws) {
    const me = userByWs.get(ws);
    if (!me?.lastOpponent) return;
    if (me.id === me.lastOpponent) return;
    startGame(me.id, me.lastOpponent).catch((e) => console.error("startGame error:", e));
  },

  rematch_decline(ws) {
    const me = userByWs.get(ws);
    if (!me?.lastOpponent) return;
    const oppWs = wsByUid.get(me.lastOpponent);
    if (oppWs) send(oppWs, { t:"rematch.declined", by: me.id });
    send(ws, { t:"rematch.declined", by: me.id });
  },
};

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  let msgCount = 0, ts = Date.now();

  broadcastOnlineStats();

  ws.on("message", (buf) => {
    const now = Date.now();
    if (now - ts > 1000) { ts = now; msgCount = 0; }
    if (++msgCount > 30) { try { ws.close(1011, "rate limit"); } catch {}; return; }

    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    const t = String(msg.t || "").replace(/\./g, "_");
    const handler = handlers[t];
    if (typeof handler === "function") {
      try { handler(ws, msg); } catch (e) { console.error("WS handler error:", e); }
    }
  });

  ws.on("close", () => {
    const u = userByWs.get(ws);
    if (u) {
      const mapped = wsByUid.get(u.id);
      if (mapped === ws) wsByUid.delete(u.id);
      userByWs.delete(ws);
      removeFromQueue(u.id);
      lastQueueJoinByUid.delete(u.id);
      for (const [gid,g] of games) if (g.X===u.id || g.O===u.id) {
        let winBy = null;
        if (g.X === u.id && g.O) winBy = "O";
        else if (g.O === u.id && g.X) winBy = "X";
        endGame(gid, "disconnect", winBy);
      }
    }
    broadcastOnlineStats();
  });
});

if (!SKIP_BOT && BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);
  bot.start((ctx) => ctx.reply("🎮 Tic-Tac-Toe", {
    reply_markup: { remove_keyboard: true }
  }));
  bot.launch();
  console.log("🤖 Bot started");
} else {
  console.log("🤖 Bot disabled");
}

(async () => {
  try { await ensureSchema(); } catch {}
  server.listen(PORT, () => {
    console.log(`✅ Server on : ${PORT}`);
    console.log(`🌐 WebApp   : ${PUBLIC_URL || `http://localhost:${PORT}`}`);
  });
})();
