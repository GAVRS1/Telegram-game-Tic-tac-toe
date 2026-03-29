import { send } from "../common/ws.js";

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const checkWin = (board) => {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { by: board[a], line: [a, b, c] };
    }
  }
  if (board.every(Boolean)) return { by: null, line: null };
  return null;
};

export const createGameState = ({ recordMatchOutcome, toWs, games }) => {
  const broadcastState = (gameId) => {
    const g = games.get(gameId);
    if (!g) return;
    const payload = { t: "game.state", board: g.board, turn: g.turn, win: checkWin(g.board) };
    send(toWs(g.X), payload);
    send(toWs(g.O), payload);
  };

  const endGame = async (gameId, reason = "end", winBy = null) => {
    const g = games.get(gameId);
    if (!g) return;

    send(toWs(g.X), { t: "game.end", reason, by: winBy });
    send(toWs(g.O), { t: "game.end", reason, by: winBy });

    try {
      if (winBy === "X" || winBy === "O") {
        const winnerUid = winBy === "X" ? g.X : g.O;
        const loserUid = winBy === "X" ? g.O : g.X;
        await recordMatchOutcome({ winnerId: winnerUid, loserId: loserUid });
      } else if (reason === "draw") {
        await recordMatchOutcome({ drawIds: [g.X, g.O] });
      }
    } catch (error) {
      console.error("recordMatchOutcome error:", error);
    }

    games.delete(gameId);
  };

  return {
    broadcastState,
    endGame,
  };
};
