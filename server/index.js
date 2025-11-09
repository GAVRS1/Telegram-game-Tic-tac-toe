import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
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
import { ensureSchema, upsertUser, recordMatchOutcome, getLeaders, getUserProfile } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const SKIP_BOT = process.env.SKIP_BOT === "1";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").trim();

// -------- HTTP (Express)
const app = express();
// We only trust the first proxy (e.g. Cloudflare) instead of all proxies to
// prevent express-rate-limit from rejecting the configuration as insecure.
app.set("trust proxy", 1);
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

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
app.use(express.static(PUBLIC_DIR));

app.get("/config.json", (req, res) => {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host  = req.headers["x-forwarded-host"]  || req.headers.host || `localhost:${PORT}`;
  const origin = `${proto}://${host}`;
  const webAppUrl = PUBLIC_URL || origin.replace(/^http:/, "https:");
  const wsUrl     = (PUBLIC_URL || origin).replace(/^http/, "ws");
  res.json({ webAppUrl, wsUrl });
});

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

app.get("*", (req, res, next) => {
  if (req.path === "/config.json") return next();
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const server = http.createServer(app);

// -------- WS (игра)
const wss = new WebSocketServer({ server });

// uid -> ws ; ws -> { id,name,username,avatar,lastOpponent,isVerified }
const wsByUid = new Map();
const userByWs = new Map();

// gameId -> { X:uid, O:uid, board[9], turn }
const games = new Map();
const queue = [];

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

const startGame = (uidA, uidB) => {
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

  const pick = (u) => u ? ({ id:u.id, name:u.name, username:u.username || '', avatar:u.avatar }) : null;

  send(toWs(X), { t:"game.start", gameId, you:"X", turn:"X", opp: pick(b) });
  send(toWs(O), { t:"game.start", gameId, you:"O", turn:"X", opp: pick(a) });

  console.log(`[GAME] ${gameId}: ${a?.name||X} vs ${b?.name||O}`);
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
wss.on("close", () => clearInterval(interval));

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

    // лог для отладки отображения имён/аватаров
    console.log(`[HELLO] uid=${uid} name="${profile.name}" verified=${profile.isVerified} src=${profile.source}`);

    // апдейт БД только для TG uid
    try {
      await ensureSchema();
      if (/^[0-9]+$/.test(uid)) {
        const usernameForDb = profile.username || profile.name;
        await upsertUser({ id: uid, username: usernameForDb, avatar_url: profile.avatar });
      }
    } catch {}
  },

  queue_join(ws) {
    if (!queue.includes(ws)) queue.push(ws);
    while (queue.length >= 2) {
      const aWs = queue.shift();
      const aId = userByWs.get(aWs)?.id;
      if (!aId) continue;

      const bIndex = queue.findIndex(w => userByWs.get(w)?.id && userByWs.get(w).id !== aId);
      if (bIndex === -1) { queue.unshift(aWs); break; }

      const [bWs] = queue.splice(bIndex, 1);
      const bId = userByWs.get(bWs)?.id;
      if (!bId || bId === aId) { queue.unshift(aWs); if (bWs) queue.push(bWs); continue; }

      startGame(aId, bId);
      break;
    }
  },

  queue_leave(ws) {
    const i = queue.indexOf(ws); if (i !== -1) queue.splice(i,1);
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
    startGame(me.id, me.lastOpponent);
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
      const qi = queue.indexOf(ws); if (qi !== -1) queue.splice(qi, 1);
      for (const [gid,g] of games) if (g.X===u.id || g.O===u.id) {
        let winBy = null;
        if (g.X === u.id && g.O) winBy = "O";
        else if (g.O === u.id && g.X) winBy = "X";
        endGame(gid, "disconnect", winBy);
      }
    }
  });
});

// -------- Telegram Bot
if (!SKIP_BOT && BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);
  bot.start((ctx) => ctx.reply("🎮 Tic-Tac-Toe", {
    reply_markup: {
      keyboard: [[{ text:"🎯 Открыть игру", web_app:{ url: PUBLIC_URL || `http://localhost:${PORT}` } }]],
      resize_keyboard:true, one_time_keyboard:true
    }
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
