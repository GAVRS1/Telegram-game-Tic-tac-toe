from __future__ import annotations

import asyncio
from typing import Optional

try:
    from telegram import Update
    from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes
except ImportError:  # pragma: no cover
    Update = None  # type: ignore
    ApplicationBuilder = None  # type: ignore
    CommandHandler = None  # type: ignore
    ContextTypes = None  # type: ignore

from .db import get_leaders, get_user_profile
from .settings import Settings


class TelegramBot:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._application = None
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if self.settings.skip_bot:
            print("🤖 Bot disabled via SKIP_BOT")
            return
        if not self.settings.bot_token:
            print("🤖 Bot token is not configured")
            return
        if ApplicationBuilder is None:
            print("🤖 python-telegram-bot is not installed")
            return

        self._application = ApplicationBuilder().token(self.settings.bot_token).build()
        self._application.add_handler(CommandHandler("start", self._cmd_start))
        self._application.add_handler(CommandHandler("stats", self._cmd_stats))
        self._application.add_handler(CommandHandler("leaders", self._cmd_leaders))
        self._application.add_handler(CommandHandler("help", self._cmd_help))
        self._task = asyncio.create_task(self._run())
        print("🤖 Bot started")

    async def stop(self) -> None:
        if not self._application:
            return
        try:
            await self._application.updater.stop()  # type: ignore[operator]
            await self._application.stop()
            await self._application.shutdown()
        finally:
            if self._task:
                await self._task
                self._task = None
            self._application = None
            print("🤖 Bot stopped")

    async def _run(self) -> None:
        if not self._application:
            return
        await self._application.initialize()
        await self._application.start()
        await self._application.updater.start_polling(drop_pending_updates=True)  # type: ignore[operator]
        await self._application.updater.wait()  # type: ignore[operator]

    async def _cmd_start(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:  # type: ignore[type-arg]
        if not update.message:
            return
        await update.message.reply_text("🎮 Привет! Используйте кнопку Web App, чтобы открыть игру Tic-Tac-Toe.")

    async def _cmd_help(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:  # type: ignore[type-arg]
        if not update.message:
            return
        await update.message.reply_text(
            "Доступные команды:\n"
            "/start — получить приветствие\n"
            "/stats — показать вашу статистику\n"
            "/leaders — топ игроков"
        )

    async def _cmd_stats(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:  # type: ignore[type-arg]
        if not update.message or not update.effective_user:
            return
        user_id = update.effective_user.id
        profile = await get_user_profile(user_id)
        if not profile:
            await update.message.reply_text("Статистика пока отсутствует. Сыграйте хотя бы один матч!")
            return
        text = (
            f"Ваши результаты:\n"
            f"Игры: {profile.get('games_played', 0)}\n"
            f"Победы: {profile.get('wins', 0)}\n"
            f"Поражения: {profile.get('losses', 0)}\n"
            f"Ничьи: {profile.get('draws', 0)}\n"
            f"Винрейт: {profile.get('win_rate', 0)}%"
        )
        await update.message.reply_text(text)

    async def _cmd_leaders(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:  # type: ignore[type-arg]
        if not update.message:
            return
        leaders = await get_leaders(5)
        if not leaders:
            await update.message.reply_text("Лидеры пока недоступны.")
            return
        lines = ["Топ игроков:"]
        for idx, leader in enumerate(leaders, start=1):
            username = leader.get("username")
            label = f"@{username}" if username else leader.get("id")
            wins = leader.get("wins", 0)
            games = leader.get("games_played", 0)
            lines.append(f"{idx}. {label} — {wins} побед (игр: {games})")
        await update.message.reply_text("\n".join(lines))
