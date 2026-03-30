import { send } from "../common/ws.js";
import { awardCoins, COIN_REASONS } from "../services/coins.js";
import { logCoinAward } from "../monitoring.js";

const MATCH_WIN_COIN_REWARD = Number(process.env.COIN_REWARD_MATCH_WIN || 100);
const ACHIEVEMENT_UNLOCK_COIN_REWARD = Number(process.env.COIN_REWARD_ACHIEVEMENT_UNLOCK || 50);

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
  const buildMeta = (g) => ({
    roundNumber: g.roundNumber,
    roundWinsX: g.roundWinsX,
    roundWinsO: g.roundWinsO,
    matchTargetWins: g.matchTargetWins,
  });

  const broadcastState = (gameId) => {
    const g = games.get(gameId);
    if (!g) return;

    const payload = {
      t: "game.state",
      board: g.board,
      turn: g.turn,
      win: checkWin(g.board),
      ...buildMeta(g),
    };
    send(toWs(g.X), payload);
    send(toWs(g.O), payload);
  };

  const resetRound = (g) => {
    g.board = Array(9).fill(null);
    g.turn = "X";
    g.roundNumber += 1;
  };

  const endMatch = async (gameId, reason = "match_end", winBy = null) => {
    const g = games.get(gameId);
    if (!g) return;

    const matchPayload = {
      t: "game.match_end",
      reason,
      by: winBy,
      ...buildMeta(g),
    };

    send(toWs(g.X), matchPayload);
    send(toWs(g.O), matchPayload);

    // Backward compatible event for legacy clients.
    send(toWs(g.X), { t: "game.end", reason, by: winBy, ...buildMeta(g) });
    send(toWs(g.O), { t: "game.end", reason, by: winBy, ...buildMeta(g) });

    try {
      let unlockedByUser = {};
      if (winBy === "X" || winBy === "O") {
        const winnerUid = winBy === "X" ? g.X : g.O;
        const loserUid = winBy === "X" ? g.O : g.X;
        unlockedByUser = await recordMatchOutcome({ winnerId: winnerUid, loserId: loserUid });
        const eventKey = `match:${gameId}:winner:${winnerUid}`;
        try {
          const awardResult = await awardCoins({
            userId: winnerUid,
            reason: COIN_REASONS.MATCH_WIN,
            amount: MATCH_WIN_COIN_REWARD,
            meta: {
              event_key: eventKey,
              source: "match_win",
              match_id: gameId,
              matchId: gameId,
            },
          });
          logCoinAward({
            source: "match_win",
            eventKey,
            userId: winnerUid,
            reason: COIN_REASONS.MATCH_WIN,
            amount: MATCH_WIN_COIN_REWARD,
            result: awardResult.alreadyAwarded ? "already_awarded" : "awarded",
            meta: { matchId: gameId },
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
            meta: { matchId: gameId },
          });
        }
      } else if (reason === "draw") {
        unlockedByUser = await recordMatchOutcome({ drawIds: [g.X, g.O] });
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
                achievementId: achievementId,
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

    games.delete(gameId);
  };

  const endRound = async (gameId, reason = "draw", winBy = null, line = null) => {
    const g = games.get(gameId);
    if (!g) return;

    if (winBy === "X") g.roundWinsX += 1;
    if (winBy === "O") g.roundWinsO += 1;

    const roundPayload = {
      t: "game.round_end",
      reason,
      by: winBy,
      line,
      ...buildMeta(g),
    };

    send(toWs(g.X), roundPayload);
    send(toWs(g.O), roundPayload);

    const target = Number(g.matchTargetWins || 3);
    if (g.roundWinsX >= target || g.roundWinsO >= target) {
      await endMatch(gameId, "win", g.roundWinsX >= target ? "X" : "O");
      return;
    }

    resetRound(g);
    broadcastState(gameId);
  };

  return {
    broadcastState,
    endRound,
    endMatch,
  };
};
