# Telegram Tic-Tac-Toe (Python Edition)

Полностью переписанный сервер Telegram WebApp на Python/FastAPI c поддержкой WebSocket-игр, PostgreSQL и Telegram-бота.

## Запуск

1. Создайте виртуальное окружение и установите зависимости:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
   pip install -r requirements.txt
   ```
2. Настройте переменные окружения (PostgreSQL, токен бота и т.д.) в `.env` или вручную.
3. Запустите сервер:
   ```bash
   python -m pyserver
   ```

Сервер по умолчанию слушает порт `8080` и автоматически стартует Telegram-бот (если задан `BOT_TOKEN`/`TELEGRAM_BOT_TOKEN`).

## Основные переменные окружения

| Переменная | Описание |
|-----------|----------|
| `PORT` | HTTP-порт (по умолчанию 8080) |
| `PUBLIC_URL` | Публичный URL, который попадёт в `config.json` и WebSocket-клиент |
| `DATABASE_URL` или `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` | Доступ к PostgreSQL |
| `PGSSL` | `require/true/1` для включения SSL (сертификат не проверяется, как и в Node-версии) |
| `TELEGRAM_BOT_TOKEN` или `BOT_TOKEN` | токен python-telegram-bot |
| `SKIP_BOT` | `1`, если бота запускать не нужно |

## Telegram-бот

Бот реализован на `python-telegram-bot` и поддерживает команды:
- `/start` — приветствие.
- `/stats` — личная статистика игрока.
- `/leaders` — топ-5 игроков.
- `/help` — краткий список команд.

## Разработка

- WebSocket-игра реализована через `FastAPI` (`/ws`).
- Очередь матчей, проверка ходов, завершение игр и heartbeat полностью перенесены из NodeJS.
- API `config.json`, `/leaders` и `/profile/:id` полностью совместимы с фронтендом из `public/`.
- Telegram WebApp-подпись (`validateTelegramWebAppData`/`extractUserData`) перенесена в `pyserver/telegram_utils.py`.

## Миграция с NodeJS

Каталог `server/` и вспомогательные Node-скрипты удалены — теперь вся логика живёт в `pyserver/`. Для туннеля Cloudflare используйте обновлённый `CFserser.bat`. Старый `start.bat` запускает Python-сервер.
