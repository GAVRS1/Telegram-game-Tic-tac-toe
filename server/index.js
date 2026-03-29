import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import "dotenv/config";
import { WebSocketServer } from "ws";
import { ensureSchema, recordMatchOutcome } from "./db.js";
import { loggingMiddleware } from "./monitoring.js";
import { send } from "./common/ws.js";
import { registerHttpRoutes } from "./http/routes/index.js";
import { createInviteService } from "./game/invites.js";
import { createGameState } from "./game/state.js";
import { createMatchmaking } from "./game/matchmaking.js";
import { createWsHandlers } from "./ws/handlers/index.js";
import { launchTelegramBot } from "./bot/telegramBot.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8080);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const SKIP_BOT = process.env.SKIP_BOT === "1";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").trim();
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").trim();

const parseCorsOrigins = (value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const allowedCorsOrigins = parseCorsOrigins(CORS_ORIGINS);

const isLocalhostOrigin = (origin) => {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
};

const originMatchesPattern = (origin, pattern) => {
  if (!pattern) return false;
  if (pattern === "*") return true;

  try {
    const originUrl = new URL(origin);
    const patternUrl = new URL(pattern);

    if (!patternUrl.hostname.startsWith("*.")) {
      return originUrl.origin === patternUrl.origin;
    }

    if (originUrl.protocol !== patternUrl.protocol) return false;

    const baseDomain = patternUrl.hostname.slice(2);
    return originUrl.hostname === baseDomain || originUrl.hostname.endsWith(`.${baseDomain}`);
  } catch {
    return false;
  }
};

const isAllowedCorsOrigin = (origin) => {
  if (!origin) return true;
  if (isLocalhostOrigin(origin)) return true;
  return allowedCorsOrigins.some((pattern) => originMatchesPattern(origin, pattern));
};

const app = express();
app.set("trust proxy", 1);

const CLIENT_DIST_DIR = path.resolve(__dirname, "..", "client", "dist");
const CLIENT_ENTRY_FILE = path.join(CLIENT_DIST_DIR, "index.html");

app.use(express.json({ limit: "100kb" }));
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "https:", "blob:"],
        "script-src": ["'self'", "https://telegram.org"],
        "script-src-attr": ["'unsafe-inline'"],
        "connect-src": ["'self'", "ws:", "wss:", "https:"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "media-src": ["'self'", "data:"],
      },
    },
  })
);
app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin)) return callback(null, true);
      return callback(new Error("CORS origin is not allowed"), false);
    },
  })
);
app.use(loggingMiddleware);
app.use(rateLimit({ windowMs: 60_000, max: 300 }));
app.use((req, _res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

const inviteService = createInviteService({ port: PORT, publicUrl: PUBLIC_URL });
registerHttpRoutes({ app, port: PORT, publicUrl: PUBLIC_URL, inviteService });

app.use(express.static(CLIENT_DIST_DIR));
app.get("*", (req, res, next) => {
  if (req.path === "/config.json") return next();
  res.sendFile(CLIENT_ENTRY_FILE);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const wsByUid = new Map();
const userByWs = new Map();
const games = new Map();

const toWs = (uid) => wsByUid.get(uid);

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
  wss.clients.forEach((ws) => send(ws, { t: "online.stats", ...stats }));
};

const gameState = createGameState({ recordMatchOutcome, toWs, games });
const matchmaking = createMatchmaking({ toWs, userByWs, games, endGame: gameState.endGame });

const handlers = createWsHandlers({
  wsByUid,
  userByWs,
  games,
  matchmaking,
  gameState,
  inviteService,
  broadcastOnlineStats,
});

const HEARTBEAT = 30000;
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try {
      ws.ping(() => {});
    } catch {}
  });
}, HEARTBEAT);

const onlineStatsInterval = setInterval(broadcastOnlineStats, 7000);
wss.on("close", () => {
  clearInterval(heartbeatInterval);
  clearInterval(onlineStatsInterval);
});

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  let msgCount = 0;
  let ts = Date.now();

  broadcastOnlineStats();

  ws.on("message", (buf) => {
    const now = Date.now();
    if (now - ts > 1000) {
      ts = now;
      msgCount = 0;
    }
    if (++msgCount > 30) {
      try {
        ws.close(1011, "rate limit");
      } catch {}
      return;
    }

    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    const t = String(msg.t || "").replace(/\./g, "_");
    const handler = handlers[t];
    if (typeof handler === "function") {
      try {
        handler(ws, msg);
      } catch (error) {
        console.error("WS handler error:", error);
      }
    }
  });

  ws.on("close", () => {
    const u = userByWs.get(ws);
    if (u) {
      const mapped = wsByUid.get(u.id);
      if (mapped === ws) wsByUid.delete(u.id);
      userByWs.delete(ws);
      matchmaking.cleanupDisconnectedUser(u.id);
    }
    broadcastOnlineStats();
  });
});

launchTelegramBot({ token: BOT_TOKEN, skip: SKIP_BOT });

(async () => {
  try {
    await ensureSchema();
  } catch {}

  server.listen(PORT, () => {
    console.log(`✅ Server on : ${PORT}`);
    console.log(`🌐 WebApp   : ${PUBLIC_URL || `http://localhost:${PORT}`}`);
    if (!process.env.NODE_ENV || process.env.NODE_ENV !== "test") {
      console.log(`📦 Client build dir: ${CLIENT_DIST_DIR}`);
      if (!existsSync(CLIENT_ENTRY_FILE)) {
        console.warn("⚠️ client/dist/index.html was not found. Build frontend in client/ before production start.");
      }
    }
  });
})();
