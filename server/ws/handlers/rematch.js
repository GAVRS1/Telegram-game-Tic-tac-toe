import { send } from "../../common/ws.js";

export const createRematchHandlers = ({ userByWs, wsByUid, matchmaking }) => ({
  rematch_offer(ws) {
    const me = userByWs.get(ws);
    if (!me?.lastOpponent) return;
    const oppWs = wsByUid.get(me.lastOpponent);
    if (oppWs) {
      const from = { id: me.id, name: me.name, username: me.username || "", avatar: me.avatar };
      send(oppWs, { t: "rematch.offer", from });
    }
  },

  rematch_accept(ws) {
    const me = userByWs.get(ws);
    if (!me?.lastOpponent || me.id === me.lastOpponent) return;
    matchmaking.startGame(me.id, me.lastOpponent).catch((error) => console.error("startGame error:", error));
  },

  rematch_decline(ws) {
    const me = userByWs.get(ws);
    if (!me?.lastOpponent) return;
    const oppWs = wsByUid.get(me.lastOpponent);
    if (oppWs) send(oppWs, { t: "rematch.declined", by: me.id });
    send(ws, { t: "rematch.declined", by: me.id });
  },
});
