import { sanitizeString } from "../validation.js";
import { getUserProfile } from "../db.js";
import { isNumericId } from "../common/id.js";
import { sanitizeUsername } from "../common/sanitize.js";
import { send } from "../common/ws.js";

export const createMatchmaking = ({ toWs, userByWs, games, endMatch }) => {
  const queueByUid = new Map();
  const queueOrder = [];
  let queueHead = 0;
  const lastQueueJoinByUid = new Map();
  const queueMetrics = {
    queueLength: 0,
    compactionCount: 0,
    totalMatchedUsers: 0,
    totalWaitMs: 0,
    averageWaitMs: 0,
  };

  const QUEUE_JOIN_THROTTLE_MS = 3000;
  const QUEUE_COMPACTION_HEAD_THRESHOLD = 200;
  const QUEUE_MAINTENANCE_INTERVAL_MS = 15000;

  const inQueue = (uid) => queueByUid.has(uid);

  const updateQueueMetrics = () => {
    queueMetrics.queueLength = queueByUid.size;
    if (queueMetrics.totalMatchedUsers > 0) {
      queueMetrics.averageWaitMs = Math.round(queueMetrics.totalWaitMs / queueMetrics.totalMatchedUsers);
    } else {
      queueMetrics.averageWaitMs = 0;
    }
  };

  const removeFromQueue = (uid) => {
    if (!uid) return;
    queueByUid.delete(uid);
    updateQueueMetrics();
  };

  const recordQueueJoin = (uid, ws) => {
    if (queueByUid.has(uid)) return false;
    queueByUid.set(uid, { ws, ts: Date.now() });
    queueOrder.push(uid);
    updateQueueMetrics();
    return true;
  };

  const compactQueueOrder = (reason) => {
    const compacted = [];
    const seen = new Set();

    for (let i = queueHead; i < queueOrder.length; i += 1) {
      const uid = queueOrder[i];
      if (!queueByUid.has(uid) || seen.has(uid)) continue;
      compacted.push(uid);
      seen.add(uid);
    }

    queueByUid.forEach((_entry, uid) => {
      if (seen.has(uid)) return;
      compacted.push(uid);
      seen.add(uid);
    });

    queueOrder.length = 0;
    queueOrder.push(...compacted);
    queueHead = 0;
    queueMetrics.compactionCount += 1;
    updateQueueMetrics();
    console.log(
      `[QUEUE] compacted reason=${reason} length=${queueOrder.length} active=${queueByUid.size} compactions=${queueMetrics.compactionCount}`
    );
  };

  const inspectQueueForAnomalies = () => {
    const now = Date.now();
    let stuckWithoutWs = 0;

    queueByUid.forEach((entry, uid) => {
      const ws = toWs(uid);
      const inUserMap = ws ? userByWs.has(ws) : false;
      if (!ws || !inUserMap || ws.readyState !== 1) {
        stuckWithoutWs += 1;
        const waitMs = now - (entry?.ts || now);
        console.warn(`[QUEUE][ANOMALY] uid=${uid} has no active ws waitMs=${waitMs}`);
      }
    });

    if (queueHead >= QUEUE_COMPACTION_HEAD_THRESHOLD) {
      compactQueueOrder("queue_head_threshold");
    }

    updateQueueMetrics();
    console.log(
      `[QUEUE][METRICS] len=${queueMetrics.queueLength} compactions=${queueMetrics.compactionCount} avgWaitMs=${queueMetrics.averageWaitMs} stuckNoWs=${stuckWithoutWs}`
    );
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

  const buildOpponentPayload = async (uid) => {
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
      } catch (error) {
        console.error("buildOpponentPayload error:", error);
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
  };

  const startGame = async (uidA, uidB) => {
    if (!uidA || !uidB || uidA === uidB) return;

    const gameId = `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const firstIsX = Math.random() < 0.5;
    const X = firstIsX ? uidA : uidB;
    const O = firstIsX ? uidB : uidA;
    games.set(gameId, {
      X,
      O,
      board: Array(9).fill(null),
      turn: "X",
      roundWinsX: 0,
      roundWinsO: 0,
      roundNumber: 1,
      matchTargetWins: 3,
    });

    const a = userByWs.get(toWs(uidA));
    const b = userByWs.get(toWs(uidB));
    if (a) a.lastOpponent = uidB;
    if (b) b.lastOpponent = uidA;

    const [oppForX, oppForO] = await Promise.all([buildOpponentPayload(O), buildOpponentPayload(X)]);

    const initialMeta = { roundWinsX: 0, roundWinsO: 0, roundNumber: 1, matchTargetWins: 3 };
    send(toWs(X), { t: "game.start", gameId, you: "X", turn: "X", opp: oppForX, ...initialMeta });
    send(toWs(O), { t: "game.start", gameId, you: "O", turn: "X", opp: oppForO, ...initialMeta });

    console.log(`[GAME] ${gameId}: ${a?.name || X} vs ${b?.name || O}`);
  };

  const dropFromQueue = (uid) => {
    if (!uid || !inQueue(uid)) return;
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

      const firstEntry = queueByUid.get(first.uid);
      const secondEntry = queueByUid.get(second.uid);
      removeFromQueue(first.uid);
      removeFromQueue(second.uid);
      const now = Date.now();
      const firstWaitMs = now - (firstEntry?.ts || now);
      const secondWaitMs = now - (secondEntry?.ts || now);
      queueMetrics.totalMatchedUsers += 2;
      queueMetrics.totalWaitMs += firstWaitMs + secondWaitMs;
      updateQueueMetrics();
      queueHead = second.index + 1;

      send(toWs(first.uid), { t: "queue.left" });
      send(toWs(second.uid), { t: "queue.left" });

      if (first.uid !== second.uid) {
        startGame(first.uid, second.uid).catch((error) => console.error("startGame error:", error));
      }

      searchIndex = queueHead;
    }
  };

  const queueJoin = (ws, uid) => {
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
    if (added) send(ws, { t: "queue.joined" });
    sendQueueWaiting(uid);
    matchmake();
  };

  const queueLeave = (ws, uid) => {
    if (!uid) return;
    if (inQueue(uid)) {
      removeFromQueue(uid);
      send(ws, { t: "queue.left" });
    }
  };

  const cleanupDisconnectedUser = (uid) => {
    removeFromQueue(uid);
    lastQueueJoinByUid.delete(uid);
    for (const [gid, g] of games) {
      if (g.X === uid || g.O === uid) {
        let winBy = null;
        if (g.X === uid && g.O) winBy = "O";
        else if (g.O === uid && g.X) winBy = "X";
        endMatch(gid, "disconnect", winBy);
      }
    }
  };

  const queueMaintenanceInterval = setInterval(inspectQueueForAnomalies, QUEUE_MAINTENANCE_INTERVAL_MS);

  return {
    inQueue,
    dropFromQueue,
    startGame,
    queueJoin,
    queueLeave,
    cleanupDisconnectedUser,
    getQueueMetrics: () => ({ ...queueMetrics }),
    stop: () => clearInterval(queueMaintenanceInterval),
  };
};
