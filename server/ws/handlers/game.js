import { validateGameMove } from "../../validation.js";
import { checkWin } from "../../game/state.js";

export const createGameHandlers = ({ userByWs, games, gameState }) => ({
  game_move(ws, msg) {
    if (!validateGameMove(msg)) return;
    const { gameId, i } = msg;
    const g = games.get(gameId);
    if (!g) return;

    const me = userByWs.get(ws)?.id;
    if (!me) return;

    const my = me === g.X ? "X" : me === g.O ? "O" : null;
    if (!my || g.turn !== my) return;
    if (g.board[i]) return;

    g.board[i] = my;
    g.turn = my === "X" ? "O" : "X";

    const res = checkWin(g.board);
    gameState.broadcastState(gameId);
    if (res) gameState.endGame(gameId, res.by === null ? "draw" : "win", res.by);
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
    gameState.endGame(gameId, "resign", winBy);
  },
});
