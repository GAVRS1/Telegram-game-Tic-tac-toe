// Ежедневная рассылка «пора сыграть» (замена reminder-цикла из server/bot/telegramBot.js).
// Запускается по расписанию Netlify Scheduled Functions.
import { Telegraf } from "telegraf";
import {
  ensureSchema,
  getTelegramSubscribersForReminder,
  markTelegramSubscriberNotified,
  setTelegramSubscriberActive,
} from "../../server/db.js";

const WEB_APP_BUTTON_TEXT = "🎮 Открыть игру";
const REMINDER_MESSAGES = [
  "🎮 Пора на реванш в крестики-нолики! Жми кнопку и заходи в игру.",
  "🔥 Давай сыграем ещё одну партию в Tic-Tac-Toe?",
  "⚡ Соперники уже ждут. Запускай игру и забирай победу!",
];

export default async () => {
  const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
  const webAppUrl = (process.env.BOT_WEB_APP_URL || process.env.PUBLIC_URL || "").trim();
  if (!token || !webAppUrl) {
    console.log("bot reminders skipped: no token or web app url");
    return;
  }

  const bot = new Telegraf(token);
  const minDays = Math.max(1, Number(process.env.BOT_REMINDER_DAYS_MIN || 2));
  const batch = Math.max(1, Math.min(200, Number(process.env.BOT_REMINDER_BATCH || 20)));

  await ensureSchema();
  const subscribers = await getTelegramSubscribersForReminder({
    maxCount: batch,
    minDaysSinceLastNotify: minDays,
  });

  for (const chatId of subscribers) {
    try {
      const text = REMINDER_MESSAGES[Math.floor(Math.random() * REMINDER_MESSAGES.length)];
      await bot.telegram.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: WEB_APP_BUTTON_TEXT, web_app: { url: webAppUrl } }]],
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
  console.log(`bot reminders processed: ${subscribers.length}`);
};

export const config = {
  schedule: "@daily",
};
