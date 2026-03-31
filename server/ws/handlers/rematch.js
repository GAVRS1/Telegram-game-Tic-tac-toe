import { send } from "../../common/ws.js";

const REMATCH_ACCEPT_TTL_MS = 2500;

export const createRematchHandlers = ({ userByWs, wsByUid, matchmaking }) => {
  const recentAccepts = new Map();

  const sweepRecentAccepts = (now = Date.now()) => {
    for (const [pairKey, expiresAt] of recentAccepts.entries()) {
      if (expiresAt <= now) recentAccepts.delete(pairKey);
    }
  };

  return {
    rematch_offer(ws) {
      const me = userByWs.get(ws);
      if (!me?.lastOpponent) return;
      const oppWs = wsByUid.get(me.lastOpponent);
      if (oppWs) {
        const from = {
          id: me.id,
          name: me.name,
          username: me.username || "",
          avatar: me.avatar,
        };
        send(oppWs, { t: "rematch.offer", from });
      }
    },

    rematch_accept(ws) {
      const me = userByWs.get(ws);
      if (!me?.lastOpponent || me.id === me.lastOpponent) return;

      const pairIds = [String(me.id), String(me.lastOpponent)].sort();
      const pairKey = pairIds.join(":");
      const now = Date.now();

      sweepRecentAccepts(now);
      const acceptedUntil = recentAccepts.get(pairKey);
      if (acceptedUntil && acceptedUntil > now) return;

      recentAccepts.set(pairKey, now + REMATCH_ACCEPT_TTL_MS);
      matchmaking.startGame(me.id, me.lastOpponent).catch((error) => {
        recentAccepts.delete(pairKey);
        console.error("startGame error:", error);
      });
    },

    rematch_decline(ws) {
      const me = userByWs.get(ws);
      if (!me?.lastOpponent) return;
      const oppWs = wsByUid.get(me.lastOpponent);
      if (oppWs) send(oppWs, { t: "rematch.declined", by: me.id });
      send(ws, { t: "rematch.declined", by: me.id });
    },
  };
};
