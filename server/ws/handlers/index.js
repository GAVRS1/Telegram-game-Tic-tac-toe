import { createGameHandlers } from "./game.js";
import { createHelloHandler } from "./hello.js";
import { createInviteHandlers } from "./invite.js";
import { createQueueHandlers } from "./queue.js";
import { createRematchHandlers } from "./rematch.js";

export const createWsHandlers = (ctx) => {
  const hello = createHelloHandler(ctx);
  const queueHandlers = createQueueHandlers(ctx);
  const gameHandlers = createGameHandlers(ctx);
  const inviteHandlers = createInviteHandlers(ctx);
  const rematchHandlers = createRematchHandlers(ctx);

  return {
    hello,
    ...inviteHandlers,
    ...queueHandlers,
    ...gameHandlers,
    ...rematchHandlers,
  };
};
