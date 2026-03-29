# Legacy `public/js` inventory and migration status

Целевой runtime-клиент в репозитории — **React/Vite приложение из `client/`**.

## Инвентаризация `public/js/*`

| Legacy файл | Статус | Замена в `client/src/*` |
|---|---|---|
| `public/js/app.js` | Перенесено, затем удалено | `client/src/App.jsx` |
| `public/js/game/board.js` | Перенесено, затем удалено | `client/src/components/Board.jsx` |
| `public/js/ui/nav.js` | Перенесено, затем удалено | `client/src/components/Nav.jsx` |
| `public/js/ui/modal.js` | Перенесено, затем удалено | `client/src/components/Modal.jsx` |
| `public/js/notifications.js` | Перенесено, затем удалено | `client/src/components/Notifications.jsx`, `client/src/hooks/useNotifications.js` |
| `public/js/ws.js` | Перенесено, затем удалено | `client/src/hooks/useWebSocket.js` |
| `public/js/state.js` | Перенесено, затем удалено | `client/src/hooks/useTelegramAuth.js`, `client/src/utils/identity.js` |
| `public/js/stats.js` | Перенесено, затем удалено | `client/src/services/statsSystem.js` |
| `public/js/audio.js` | Перенесено, затем удалено | `client/src/services/audioManager.js` |
| `public/js/animations.js` | Deprecated, удалено (не требуется в runtime) | CSS/React-рендер win-состояний в `client/src/components/Board.jsx` |
| `public/js/config-loader.js` | Deprecated, удалено (runtime конфиг через Vite env / backend origin) | `client/src/utils/network.js` |

## Решение по legacy

- Папка `public/js/` удалена из репозитория.
- React/Vite клиент в `client/` остаётся единственной runtime-реализацией.
- Для защиты от регрессий добавлена CI-проверка `check:single-client`.
