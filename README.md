# Tic-Tac-Toe для Telegram Web App

Кроссплатформенная игра «крестики-нолики» запускается прямо внутри Telegram как Web App. Пользователь открывает бота, авторизуется через Telegram Web App SDK и подключается к серверу по WebSocket, чтобы играть в реальном времени. [Сайт игры](https://tttoeonl.ru/)

## Кратко о проекте
- **Бэкенд**: Node.js + Express обслуживает статику, отдаёт `config.json` для фронтенда, валидирует подписи Telegram Web App и держит WebSocket-подключения.
- **Фронтенд**: находится в `public/`, написан на ванильном JS, использует Telegram Web App SDK и WebSocket для обмена ходами.
- **Данные**: PostgreSQL хранит профили, статистику и достижения игроков.
- **Инфраструктура**: защита заголовков через Helmet, ограничение запросов, мониторинг, миграции БД через скрипты Node.js.

## Связка бэкенда и фронтенда
1. Фронтенд грузится из `public/index.html`, читает `/config.json` и открывает WebSocket на том же хосте.
2. Telegram Web App SDK передаёт данные авторизации; сервер проверяет подпись, создаёт/обновляет профиль и ставит игрока в очередь.
3. Все игровые события (очередь, ходы, завершение) идут через WebSocket; сервер валидирует ходы и транслирует состояние двум соперникам.
4. Результаты записываются в PostgreSQL, достижения пересчитываются и доступны через REST-эндпоинты `/leaders` и `/profile/:id`.

## Структура файлов
```
.
├── public/              # Фронтенд (index.html, стили, скрипты, изображения)
│   ├── js/
│   ├── img/
│   ├── styles.css
│   └── index.html
├── server/              # Бэкенд и вспомогательные модули
│   ├── index.js         # Точки входа HTTP + WebSocket, отдача статики и config.json
│   ├── db.js            # Подключение к PostgreSQL и запросы
│   ├── migrate.js       # Скрипт применения миграций
│   ├── telegramAuth.js  # Проверка подписи Telegram Web App
│   ├── achievements.js  # Работа с достижениями
│   ├── validation.js    # Валидация входных данных
│   ├── rateLimit.js     # Ограничение запросов
│   ├── monitoring.js    # Логирование и метрики
│   └── errorHandler.js  # Единая обработка ошибок
├── migrations/          # SQL-миграции для схемы БД
├── package.json         # Скрипты и зависимости
├── package-lock.json
├── QRcode.jpg  
└── README.md
```

## Технологии
- Node.js 18+
- Express, Helmet, CORS
- WebSocket (ws)
- PostgreSQL (pg)
- Telegram (бот для выдачи Web App)
- Vanilla JS + Telegram Web App SDK

## Как запустить локально
1. Установите зависимости: `npm install`.
2. Создайте `.env` с настройками:
   - `PORT` — порт HTTP/WS (по умолчанию 8080);
   - `BOT_TOKEN` — токен Telegram-бота;
   - `PUBLIC_URL` — внешний URL для Web App (если отличается от локального);
   - параметры подключения к PostgreSQL (`DATABASE_URL` или `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSL`).
3. Примените миграции: `npm run migrate` (создаст таблицы для пользователей, статистики и достижений).
4. Запустите сервер: `npm run start` (start.bat). Статика будет по `http://localhost:8080`, WebSocket — на том же хосте.

## QR-код бота
QR ведёт прямо к игровому боту в Telegram. Размер уменьшен для удобного отображения:

![QR-код бота](QRcode.jpg)

## Лицензия
MIT — см. файл `LICENSE`.
