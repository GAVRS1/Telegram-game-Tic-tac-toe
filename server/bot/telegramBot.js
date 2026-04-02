import { Telegraf } from "telegraf";
import { parseStartPayload } from "../common/startPayload.js";
import {
  getTelegramSubscribersForReminder,
  markTelegramSubscriberNotified,
  setTelegramSubscriberActive,
  upsertTelegramSubscriber,
} from "../db.js";

const WEB_APP_BUTTON_TEXT = "🎮 Открыть игру";
const REMINDER_MESSAGES = [
  "🎮 Пора на реванш в крестики-нолики! Жми кнопку и заходи в игру.",
  "🔥 Давай сыграем ещё одну партию в Tic-Tac-Toe?",
  "⚡ Соперники уже ждут. Запускай игру и забирай победу!",
];

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

const pickReminderText = () =>
  REMINDER_MESSAGES[Math.floor(Math.random() * REMINDER_MESSAGES.length)];

export const launchTelegramBot = ({ token, skip, webAppUrl }) => {
  if (!skip && token) {
    const bot = new Telegraf(token);
    const normalizedWebAppUrl = typeof webAppUrl === "string" ? webAppUrl.trim() : "";
    bot.start((ctx) => {
      const startPayload = typeof ctx.startPayload === "string" ? ctx.startPayload.trim() : "";
      const replyWebAppUrl = buildWebAppUrl(normalizedWebAppUrl, startPayload);
      const reply = buildStartReply({ webAppUrl: replyWebAppUrl, startPayload });

      const chatId = ctx.chat?.id;
      const from = ctx.from || {};
      upsertTelegramSubscriber({
        chatId,
        userId: from.id,
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
        isActive: true,
      }).catch((error) => {
        console.error("telegram subscriber save error:", error);
      });
      return ctx.reply(reply.text, reply.extra);
    });

    bot.on("my_chat_member", (ctx) => {
      const chatId = ctx.chat?.id;
      const nextStatus = String(ctx.update?.my_chat_member?.new_chat_member?.status || "");
      const isActive = ["member", "administrator", "creator"].includes(nextStatus);
      setTelegramSubscriberActive(chatId, isActive).catch((error) => {
        console.error("telegram subscriber status update error:", error);
      });
    });

    const intervalDaysMin = Math.max(1, Number(process.env.BOT_REMINDER_DAYS_MIN || 2));
    const intervalDaysMax = Math.max(
      intervalDaysMin,
      Number(process.env.BOT_REMINDER_DAYS_MAX || 3),
    );
    const reminderCheckMs = Math.max(60_000, Number(process.env.BOT_REMINDER_CHECK_MS || 60_000));
    const sendBatchLimit = Math.max(1, Math.min(200, Number(process.env.BOT_REMINDER_BATCH || 20)));

    let nextReminderAt = Date.now() + intervalDaysMin * 24 * 60 * 60 * 1000;
    const planNextReminder = () => {
      const nextDays = intervalDaysMin + Math.random() * (intervalDaysMax - intervalDaysMin);
      nextReminderAt = Date.now() + nextDays * 24 * 60 * 60 * 1000;
    };

    const runReminderTick = async () => {
      if (!normalizedWebAppUrl) return;
      if (Date.now() < nextReminderAt) return;
      const subscribers = await getTelegramSubscribersForReminder({
        maxCount: sendBatchLimit,
        minDaysSinceLastNotify: intervalDaysMin,
      });
      for (const chatId of subscribers) {
        try {
          await bot.telegram.sendMessage(chatId, pickReminderText(), {
            reply_markup: {
              inline_keyboard: [[{ text: WEB_APP_BUTTON_TEXT, web_app: { url: normalizedWebAppUrl } }]],
            },
          });
          await markTelegramSubscriberNotified(chatId);
        } catch (error) {
          const errCode = Number(error?.response?.error_code || 0);
          if (errCode === 403 || errCode === 400) {
            await setTelegramSubscriberActive(chatId, false);
          } else {
            console.error(`telegram reminder send error for chat ${chatId}:`, error);
          }
        }
      }
      planNextReminder();
    };

    setInterval(() => {
      runReminderTick().catch((error) => {
        console.error("telegram reminder tick error:", error);
      });
    }, reminderCheckMs);

    bot.launch();
    console.log("🤖 Bot started");
    return;
  }

  console.log("🤖 Bot disabled");
};
