// Telegram-бот через webhook (замена long-polling из server/bot/telegramBot.js).
// Webhook устанавливается один раз:
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<site>/telegram/webhook&secret_token=<SECRET>
import { Telegraf } from "telegraf";
import { parseStartPayload } from "../../server/common/startPayload.js";
import {
  ensureSchema,
  setTelegramSubscriberActive,
  upsertTelegramSubscriber,
} from "../../server/db.js";

const WEB_APP_BUTTON_TEXT = "🎮 Открыть игру";

const buildWebAppUrl = (baseUrl, startPayload = "") => {
  const root = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
  if (!root) return "";
  if (!startPayload) return root;
  return `${root}/?tgWebAppStartParam=${encodeURIComponent(startPayload)}`;
};

let bot = null;
let schemaReady = null;

const getBot = (webAppBase) => {
  if (bot) return bot;
  const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token) return null;
  bot = new Telegraf(token, { handlerTimeout: 9_000 });

  bot.start((ctx) => {
    const startPayload = typeof ctx.startPayload === "string" ? ctx.startPayload.trim() : "";
    const replyWebAppUrl = buildWebAppUrl(webAppBase, startPayload);
    const parsedPayload = parseStartPayload(startPayload);
    let payloadHint = "";
    if (parsedPayload.kind === "referral") payloadHint = `\nРеферальный код: ${parsedPayload.refCode}`;
    if (parsedPayload.kind === "lobby_invite") payloadHint = `\nИнвайт в лобби: ${parsedPayload.inviteCode}`;

    const from = ctx.from || {};
    upsertTelegramSubscriber({
      chatId: ctx.chat?.id,
      userId: from.id,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      isActive: true,
    }).catch((error) => console.error("telegram subscriber save error:", error));

    const extra = replyWebAppUrl
      ? {
          reply_markup: {
            inline_keyboard: [[{ text: WEB_APP_BUTTON_TEXT, web_app: { url: replyWebAppUrl } }]],
          },
        }
      : { reply_markup: { remove_keyboard: true } };
    return ctx.reply(`🎮 Tic-Tac-Toe${payloadHint}`, extra);
  });

  bot.on("my_chat_member", (ctx) => {
    const chatId = ctx.chat?.id;
    const nextStatus = String(ctx.update?.my_chat_member?.new_chat_member?.status || "");
    const isActive = ["member", "administrator", "creator"].includes(nextStatus);
    setTelegramSubscriberActive(chatId, isActive).catch((error) =>
      console.error("telegram subscriber status update error:", error)
    );
  });

  return bot;
};

export default async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const expectedSecret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (expectedSecret) {
    const gotSecret = req.headers.get("x-telegram-bot-api-secret-token") || "";
    if (gotSecret !== expectedSecret) return new Response("forbidden", { status: 403 });
  }

  const webAppBase =
    (process.env.BOT_WEB_APP_URL || process.env.PUBLIC_URL || "").trim() || new URL(req.url).origin;
  const instance = getBot(webAppBase);
  if (!instance) return new Response("bot disabled");

  try {
    if (!schemaReady) schemaReady = ensureSchema();
    await schemaReady;
  } catch {}

  try {
    const update = await req.json();
    await instance.handleUpdate(update);
  } catch (error) {
    console.error("telegram webhook error:", error);
  }
  // Telegram ждёт 200, иначе будет ретраить update
  return new Response("ok");
};

export const config = {
  path: "/telegram/webhook",
};
