import { Telegraf } from "telegraf";

export const launchTelegramBot = ({ token, skip }) => {
  if (!skip && token) {
    const bot = new Telegraf(token);
    bot.start((ctx) =>
      ctx.reply("🎮 Tic-Tac-Toe", {
        reply_markup: { remove_keyboard: true },
      })
    );
    bot.launch();
    console.log("🤖 Bot started");
    return;
  }

  console.log("🤖 Bot disabled");
};
