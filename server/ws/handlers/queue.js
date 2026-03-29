export const createQueueHandlers = ({ userByWs, matchmaking }) => ({
  queue_join(ws) {
    const uid = userByWs.get(ws)?.id;
    if (!uid) return;
    matchmaking.queueJoin(ws, uid);
  },

  queue_leave(ws) {
    const uid = userByWs.get(ws)?.id;
    if (!uid) return;
    matchmaking.queueLeave(ws, uid);
  },
});
