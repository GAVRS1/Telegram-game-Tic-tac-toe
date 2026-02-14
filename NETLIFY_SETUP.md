# Инструкция: как подключить фронтенд к Netlify

## Что уже добавлено в проект
- `netlify.toml` в корне репозитория (Netlify будет собирать проект из папки `client/`).
- Поддержка переменных окружения для фронтенда:
  - `VITE_API_BASE_URL` — базовый URL вашего backend API.
  - `VITE_WS_URL` — полный URL WebSocket сервера.
- Файл `client/netlify.env.example` с примером переменных.

## 1) Подготовьте backend
Netlify хостит фронтенд (статический сайт). Ваш Node.js/WebSocket сервер нужно развернуть отдельно (например, Render, Railway, VPS).

Убедитесь, что backend доступен по HTTPS/WSS, например:
- API: `https://api.example.com`
- WebSocket: `wss://api.example.com`

## 2) Подключите репозиторий в Netlify
1. Зайдите в Netlify → **Add new site** → **Import an existing project**.
2. Выберите GitHub/GitLab/Bitbucket и ваш репозиторий.
3. Netlify прочитает `netlify.toml` автоматически.

Параметры сборки (если нужно проверить вручную):
- **Base directory**: `client`
- **Build command**: `npm run build`
- **Publish directory**: `dist`

## 3) Добавьте переменные окружения в Netlify
В Netlify: **Site settings → Environment variables** добавьте:

- `VITE_API_BASE_URL` = `https://api.example.com`
- `VITE_WS_URL` = `wss://api.example.com`

> Важно: переменные с префиксом `VITE_` встраиваются в клиентский бандл при сборке.

## 4) Запустите деплой
1. Нажмите **Deploy site** (или запушьте изменения в ветку, подключенную к Netlify).
2. После деплоя откройте URL сайта Netlify.
3. Проверьте работу:
   - загружается UI,
   - открывается WebSocket,
   - работает рейтинг/профиль.

## 5) Подключение к Telegram Web App
1. Откройте `@BotFather` → ваш бот → **Bot Settings** → **Menu Button** (или команду для Web App).
2. Укажите URL вашего Netlify-сайта (например, `https://your-site.netlify.app`).
3. Если используете свой домен — добавьте его в Netlify и используйте уже доменный URL в настройках бота.

## 6) Локальная проверка перед деплоем
Из папки `client`:

```bash
npm install
npm run build
npm run preview
```

Для локальной проверки с переменными можно создать `client/.env.local`:

```env
VITE_API_BASE_URL=https://api.example.com
VITE_WS_URL=wss://api.example.com
```

## Частые проблемы
- **Ошибка CORS**: разрешите домен Netlify в настройках backend CORS.
- **WebSocket не подключается**: используйте именно `wss://` в production.
- **404 при обновлении страницы**: уже решено через SPA-redirect в `netlify.toml`.
