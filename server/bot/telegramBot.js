import { Telegraf } from "telegraf";
import { parseStartPayload } from "../common/startPayload.js";

const WEB_APP_BUTTON_TEXT = "🎮 Открыть игру";

const buildWebAppUrl = (baseUrl, startPayload = "") => {
  const root = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
  if (!root) return "";
  if (!startPayload) return root;
  return `${root}/?tgWebAppStartParam=${encodeURIComponent(startPayload)}`;
};

const buildStartReply = ({ webAppUrl, startPayload }) => {
  const parsedPayload = parseStartPayload(startPayload);
  let payloadHint = "";
  if (parsedPayload.kind === "referral") payloadHint = `\nРеферальный код: ${parsedPayload.refCode}`;
  if (parsedPayload.kind === "lobby_invite") payloadHint = `\nИнвайт в лобби: ${parsedPayload.inviteCode}`;

  const message = `🎮 Tic-Tac-Toe${payloadHint}`;
  if (!webAppUrl) {
    return {
      text: message,
      extra: { reply_markup: { remove_keyboard: true } },
    };
  }

  return {
    text: message,
    extra: {
      reply_markup: {
        inline_keyboard: [[{ text: WEB_APP_BUTTON_TEXT, web_app: { url: webAppUrl } }]],
      },
    },
  };
};

export const launchTelegramBot = ({ token, skip, publicUrl }) => {
  if (!skip && token) {
    const bot = new Telegraf(token);
    bot.start((ctx) => {
      const startPayload = typeof ctx.startPayload === "string" ? ctx.startPayload.trim() : "";
      const webAppUrl = buildWebAppUrl(publicUrl, startPayload);
      const reply = buildStartReply({ webAppUrl, startPayload });
      return ctx.reply(reply.text, reply.extra);
    });
    bot.launch();
    console.log("🤖 Bot started");
    return;
  }

  console.log("🤖 Bot disabled");
};
