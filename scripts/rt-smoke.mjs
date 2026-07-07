// Смоук-тест serverless realtime-движка (server/realtime/core.js).
// Запуск: node scripts/rt-smoke.mjs  (нужен доступный Postgres из .env / NETLIFY_DATABASE_URL)
// Сценарий: два игрока, очередь, матч до 3 побед, реванш, сдача, лидерборд.
import "dotenv/config";
import { rtConnect, rtPoll, rtSend } from "../server/realtime/core.js";
import { getLeaders } from "../server/db.js";

const A = "111111";
const B = "222222";

const log = (...args) => console.log(...args);
const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exit(1);
};

const collect = new Map(); // uid -> messages

const push = (uid, res) => {
  if (!collect.has(uid)) collect.set(uid, []);
  for (const m of res.messages || []) collect.get(uid).push(m);
};

const lastOfType = (uid, t) => {
  const list = collect.get(uid) || [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].t === t) return list[i];
  return null;
};

const main = async () => {
  const ca = await rtConnect();
  const cb = await rtConnect();
  if (!ca.sid || !cb.sid) fail("no sid");
  log("connected", ca.sid.slice(0, 8), cb.sid.slice(0, 8));

  push(A, await rtSend(ca.sid, { t: "hello", uid: A, name: "Alice Test", username: "alice_t" }));
  push(B, await rtSend(cb.sid, { t: "hello", uid: B, name: "Bob Test", username: "bob_t" }));

  push(A, await rtSend(ca.sid, { t: "queue.join" }));
  push(B, await rtSend(cb.sid, { t: "queue.join" }));
  push(A, await rtPoll(ca.sid));
  push(B, await rtPoll(cb.sid));

  const startA = lastOfType(A, "game.start");
  const startB = lastOfType(B, "game.start");
  if (!startA || !startB) fail("no game.start: " + JSON.stringify([collect.get(A), collect.get(B)]));
  log("game started", startA.gameId, "A is", startA.you, "opp of A:", startA.opp?.name);
  if (startA.gameId !== startB.gameId) fail("different games");

  const sidByMark = { [startA.you]: ca.sid, [startB.you]: cb.sid };
  const uidByMark = { [startA.you]: A, [startB.you]: B };
  const gameId = startA.gameId;

  // X выигрывает раунд: X ходит 0,1,2; O ходит 3,4
  const playRound = async () => {
    const seq = [
      ["X", 0],
      ["O", 3],
      ["X", 1],
      ["O", 4],
      ["X", 2],
    ];
    for (const [mark, i] of seq) {
      const res = await rtSend(sidByMark[mark], { t: "game.move", gameId, i });
      push(uidByMark[mark], res);
    }
    push(uidByMark.X, await rtPoll(sidByMark.X));
    push(uidByMark.O, await rtPoll(sidByMark.O));
  };

  for (let round = 1; round <= 3; round += 1) {
    await playRound();
    const re = lastOfType(uidByMark.X, "game.round_end");
    log(
      `round ${round}:`,
      re ? `${re.reason} by ${re.by} (X:${re.roundWinsX} O:${re.roundWinsO})` : "no round_end"
    );
    if (!re || re.by !== "X") fail("round not won by X");
  }

  const meA = lastOfType(A, "game.match_end");
  if (!meA || meA.by !== "X") fail("no match_end win by X: " + JSON.stringify(meA));
  log("match ended:", meA.reason, "by", meA.by);

  // Реванш
  push(uidByMark.O, await rtSend(sidByMark.O, { t: "rematch.offer" }));
  push(uidByMark.X, await rtPoll(sidByMark.X));
  const offer = lastOfType(uidByMark.X, "rematch.offer");
  if (!offer) fail("no rematch.offer delivered");
  log("rematch offered by", offer.from?.name);
  push(uidByMark.X, await rtSend(sidByMark.X, { t: "rematch.accept" }));
  push(A, await rtPoll(ca.sid));
  push(B, await rtPoll(cb.sid));
  const start2 = lastOfType(A, "game.start");
  if (!start2 || start2.gameId === gameId) fail("no new game after rematch");
  log("rematch game:", start2.gameId);

  // Сдача
  push(A, await rtSend(ca.sid, { t: "game.resign", gameId: start2.gameId }));
  push(B, await rtPoll(cb.sid));
  push(A, await rtPoll(ca.sid));
  const me2 = lastOfType(B, "game.match_end");
  if (!me2 || me2.reason !== "resign") fail("no resign match_end: " + JSON.stringify(me2));
  log("resign works, winner:", me2.by);

  const stats = lastOfType(A, "online.stats");
  log("online stats:", JSON.stringify(stats));

  const leaders = await getLeaders(5);
  log("leaders top:", leaders.map((l) => `${l.username}:${l.wins}w`).join(", "));

  log("SMOKE OK");
  process.exit(0);
};

main().catch((error) => {
  console.error("SMOKE ERROR:", error);
  process.exit(1);
});
