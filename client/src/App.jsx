import React, { useCallback, useEffect, useRef, useState } from "react";
import { Board } from "./components/Board.jsx";
import { GameModesCarousel } from "./components/GameModesCarousel.jsx";
import { Nav } from "./components/Nav.jsx";
import { Modal } from "./components/Modal.jsx";
import { Notifications } from "./components/Notifications.jsx";
import { useTelegramAuth } from "./hooks/useTelegramAuth.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useNotifications } from "./hooks/useNotifications.js";
import { audioManager } from "./services/audioManager.js";
import { StatsSystem } from "./services/statsSystem.js";
import { isNumericId, normalizeId, sanitizeUsername } from "./utils/identity.js";
import { apiUrl, resolveWsUrl } from "./utils/network.js";

const WIN_PHRASES = [
  "Поздравляем! Вы сыграли мощно 👑",
  "Отличная победа! Так держать 🚀",
  "Браво! Красиво переиграли соперника 🏆",
  "Победа за вами! Скилл на месте 🔥",
];
const LOSE_PHRASES = [
  "Ничего страшного, получится в следующий раз! 💪",
  "Хорошая попытка! Ещё немного — и победа будет ваша ✨",
  "Не сдавайтесь — следующий матч за вами 💥",
  "Сильная игра! Чуть-чуть не хватило, но всё впереди 🧠",
];
const DRAW_PHRASES = [
  "Отличный матч! Вы держались на равных 🤝",
  "Крутая заруба — никто не уступил! ⚖️",
  "Это была достойная ничья. До новой встречи! 🎲",
  "Ни шагу назад! Равная борьба до конца 💫",
];

const initialGameState = {
  gameId: null,
  you: null,
  turn: "X",
  board: Array(9).fill(null),
  opp: null,
  lastOpp: null,
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function vibrate(ms = 15) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

function buildResultContent(baseText, phrasesPool) {
  const blocks = [<p key="main" className="modal-text">{String(baseText ?? "")}</p>];
  const extra = Array.isArray(phrasesPool) && phrasesPool.length ? pick(phrasesPool) : null;
  if (extra) blocks.push(<p key="extra" className="modal-phrase">{extra}</p>);
  return blocks;
}

function needsOpponentDetails(opp) {
  if (!opp) return false;
  const hasAvatar = typeof opp.avatar === "string" && opp.avatar.trim() !== "";
  const hasUsername = typeof opp.username === "string" && opp.username.trim() !== "";
  return !hasAvatar || !hasUsername;
}

function declOfNum(number, titles) {
  const cases = [2, 0, 1, 1, 1, 2];
  return titles[
    number % 100 > 4 && number % 100 < 20
      ? 2
      : cases[number % 10 < 5 ? number % 10 : 5]
  ];
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatAchievementProgressText(achievement) {
  const target = Number(achievement?.target ?? 0) || 0;
  const value = Number(achievement?.progress_value ?? 0) || 0;
  if (achievement?.metric === "win_rate") {
    return `${Math.round(value)}% / ${target}%`;
  }
  const capped = target > 0 ? Math.min(value, target) : value;
  return `${Math.round(capped)}/${target}`;
}

function buildAchievementHint(achievement) {
  if (achievement?.metric === "win_rate") {
    const minGames = Number(achievement?.details?.minGames ?? achievement?.extra?.min_games ?? 0) || 0;
    const gamesPlayed = Number(achievement?.details?.gamesPlayed ?? 0) || 0;
    if (minGames > 0 && gamesPlayed < minGames) {
      const remaining = Math.max(0, minGames - gamesPlayed);
      if (remaining > 0) {
        return `Сыграйте ещё ${remaining} ${declOfNum(remaining, ["игру", "игры", "игр"])}, чтобы открыть достижение.`;
      }
    }
  }
  return "";
}

function formatDate(value) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  } catch {
    return "";
  }
}

function resolveInviteCodeFromLocation() {
  if (typeof window === "undefined") return "";

  try {
    const params = new URLSearchParams(window.location.search);
    const directRef = params.get("ref")?.trim();
    if (directRef) return directRef;

    const telegramStart = params.get("tgWebAppStartParam")?.trim();
    if (telegramStart) return telegramStart;
  } catch {}

  const tg = window.Telegram?.WebApp;
  const startParam = tg?.initDataUnsafe?.start_param;
  return typeof startParam === "string" ? startParam.trim() : "";
}

export default function App() {
  const { telegram, initData, me, refreshIdentity, meRef } = useTelegramAuth();
  const [game, setGame] = useState(initialGameState);
  const [status, setStatus] = useState({ text: "Готово", blink: false });
  const [screen, setScreen] = useState("modes");
  const [activeModeIndex, setActiveModeIndex] = useState(0);
  const [navMode, setNavMode] = useState("find");
  const [onlineStats, setOnlineStats] = useState({ total: 0, verified: 0, guest: 0 });
  const [modalState, setModalState] = useState({
    open: false,
    title: "",
    content: null,
    primary: null,
    secondary: null,
  });
  const [winLine, setWinLine] = useState(null);
  const [pendingInviteCode, setPendingInviteCode] = useState(() => {
    return resolveInviteCodeFromLocation();
  });

  const gameRef = useRef(game);
  const sendRef = useRef(() => {});
  const wsConnectedRef = useRef(false);
  const lastHelloFingerprintRef = useRef("");
  const pendingOppProfiles = useRef(new Set());
  const pendingInviteShareModeRef = useRef("link");
  const statsSystemRef = useRef(null);
  const mountedRef = useRef(true);

  const notifications = useNotifications();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    if (pendingInviteCode) return;
    const nextCode = resolveInviteCodeFromLocation();
    if (nextCode) setPendingInviteCode(nextCode);
  }, [pendingInviteCode, telegram, initData]);

  useEffect(() => {
    statsSystemRef.current = new StatsSystem(() => meRef.current);
  }, [meRef]);

  const wsUrl = resolveWsUrl();

  const sendWs = useCallback((payload) => sendRef.current(payload), []);

  const shareInviteLink = useCallback(
    async (link) => {
      if (!link) return;
      const text = "Сразимся в крестики-нолики в Telegram!";
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;

      try {
        if (telegram?.openTelegramLink) {
          telegram.openTelegramLink(shareUrl);
          notifications.success("Окно Telegram для отправки приглашения открыто");
          return;
        }
      } catch {}

      try {
        await navigator.clipboard?.writeText(link);
        notifications.success("Ссылка скопирована в буфер обмена");
      } catch {
        notifications.info("Ссылка приглашения готова: отправьте её другу в Telegram");
      }
    },
    [notifications, telegram]
  );

  const createInvite = useCallback(({ share = "link" } = {}) => {
    pendingInviteShareModeRef.current = share;
    setScreen("game");
    sendWs({ t: "invite.create" });
    setStatus({ text: "Создаём ссылку приглашения…", blink: true });
    audioManager.playClick();
  }, [sendWs]);

  const setModal = useCallback((next) => {
    setModalState((prev) => ({ ...prev, ...next, open: true }));
  }, []);

  const hideModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, open: false }));
  }, []);

  const startQueueSearch = useCallback(
    ({ notify = true, playSound = true } = {}) => {
      setScreen("game");
      sendWs({ t: "queue.join" });
      setNavMode("waiting");
      setStatus({ text: "Поиск соперника…", blink: true });
      if (notify) notifications.info("Поиск соперника…");
      if (playSound) audioManager.playClick();
    },
    [notifications, sendWs]
  );

  const cancelQueueSearch = useCallback(
    ({ notify = true, playSound = true } = {}) => {
      sendWs({ t: "queue.leave" });
      if (!gameRef.current.gameId) setScreen("modes");
      setNavMode("find");
      setStatus({ text: "Готово", blink: false });
      if (notify) notifications.info("Поиск остановлен");
      if (playSound) audioManager.playClick();
    },
    [notifications, sendWs]
  );

  const inviteLastOpponent = useCallback(() => {
    const lastOpp = gameRef.current.lastOpp;
    if (!lastOpp?.id) {
      startQueueSearch({ notify: false, playSound: false });
      return;
    }
    setStatus({ text: "Отправлено приглашение на реванш…", blink: true });
    notifications.info("Приглашение отправлено");
    sendWs({ t: "rematch.offer", to: lastOpp.id, prevGameId: gameRef.current.gameId || null });
    audioManager.playClick();
  }, [notifications, sendWs, startQueueSearch]);

  const acceptRematch = useCallback(
    (fromId) => {
      setStatus({ text: "Подтверждение реванша…", blink: false });
      sendWs({ t: "rematch.accept", to: fromId });
      audioManager.playClick();
    },
    [sendWs]
  );

  const toLobby = useCallback(() => {
    setGame((prev) => ({
      ...prev,
      gameId: null,
      you: null,
      turn: "X",
      board: Array(9).fill(null),
      opp: null,
    }));
    setWinLine(null);
    hideModal();
    setScreen("modes");
    setStatus({ text: "Готово", blink: false });
    sendWs({ t: "queue.leave" });
  }, [hideModal, sendWs]);

  const handlePlayOnline = useCallback(() => {
    startQueueSearch();
  }, [startQueueSearch]);

  const openComputerStub = useCallback(() => {
    setScreen("game");
    setModal({
      title: "Играть с компьютером",
      content: "Режим против бота скоро появится. Пока доступна игра онлайн и с друзьями.",
      primary: {
        label: "Ок",
        onClick: () => hideModal(),
      },
      secondary: { show: false },
    });
  }, [hideModal, setModal]);

  const declineRematch = useCallback(
    (fromId) => {
      setStatus({ text: "Готово", blink: false });
      sendWs({ t: "rematch.decline", to: fromId });
      toLobby();
      audioManager.playClick();
    },
    [sendWs, toLobby]
  );

  const onNavAction = useCallback(
    (mode) => {
      if (mode === "find") {
        startQueueSearch();
      }
      if (mode === "waiting") {
        cancelQueueSearch();
      }
      if (mode === "resign") {
        if (gameRef.current.gameId) {
          setModal({
            title: "Сдаться?",
            content: "Вы уверены, что хотите сдаться?",
            primary: {
              label: "Сдаться",
              onClick: () => {
                sendWs({ t: "game.resign", gameId: gameRef.current.gameId });
                hideModal();
                audioManager.playClick();
              },
            },
            secondary: {
              label: "Отмена",
              onClick: () => {
                hideModal();
                audioManager.playClick();
              },
            },
          });
        }
      }
      if (mode === "rematch") inviteLastOpponent();
    },
    [cancelQueueSearch, hideModal, inviteLastOpponent, sendWs, setModal, startQueueSearch]
  );

  const handleCellClick = useCallback(
    (index) => {
      const currentGame = gameRef.current;
      if (!currentGame.gameId) return;
      const myMoveAllowed = currentGame.you && currentGame.you === currentGame.turn && currentGame.gameId;
      if (!myMoveAllowed || currentGame.board[index]) return;

      vibrate(10);
      audioManager.playClick();
      statsSystemRef.current?.recordMove(index);
      sendWs({ t: "game.move", gameId: currentGame.gameId, i: index });
    },
    [sendWs]
  );

  const handleAuthorClick = useCallback(() => {
    const link = "https://t.me/rsgavrs";
    try {
      if (telegram?.openTelegramLink) telegram.openTelegramLink(link);
      else window.open(link, "_blank", "noopener");
    } catch {
      window.open(link, "_blank", "noopener");
    }
  }, [telegram]);

  const loadRating = useCallback(async () => {
    setModal({
      title: "Топ игроков",
      content: "Загрузка…",
      primary: {
        label: "Закрыть",
        onClick: () => hideModal(),
      },
      secondary: { show: false },
    });

    try {
      const response = await fetch(apiUrl("/leaders"), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const rows = Array.isArray(data?.leaders) ? data.leaders : [];

      const content = (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "50vh", overflow: "auto" }}>
          {rows.length === 0 ? (
            <div>Список пуст.</div>
          ) : (
            rows.map((user, index) => (
              <div
                key={`${user.username || "player"}-${index}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  border: "1px solid var(--line)",
                  borderRadius: "10px",
                  padding: "8px",
                }}
              >
                <div style={{ width: "24px", textAlign: "right", fontWeight: 700 }}>{index + 1}</div>
                <img
                  src={user.avatar_url || "/img/logo.svg"}
                  alt=""
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "1px solid var(--line)",
                  }}
                />
                <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.username || "Player"}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: "4px",
                    fontSize: "12px",
                    color: "var(--muted)",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>🏆 {Number(user.wins ?? 0)}</div>
                  <div>🎮 {Number(user.games_played ?? 0)} | ⚖️ {Number(user.win_rate ?? 0)}%</div>
                </div>
              </div>
            ))
          )}
        </div>
      );

      setModal({
        title: "Топ игроков",
        content,
        primary: {
          label: "Закрыть",
          onClick: () => hideModal(),
        },
        secondary: { show: false },
      });
    } catch {
      setModal({
        title: "Топ игроков",
        content: "Рейтинг недоступен. Проверь БД и /leaders.",
        primary: {
          label: "Закрыть",
          onClick: () => hideModal(),
        },
        secondary: { show: false },
      });
    }
  }, [hideModal, setModal]);

  const loadProfile = useCallback(async () => {
    setModal({
      title: "Профиль",
      content: "Загрузка…",
      primary: {
        label: "Ок",
        onClick: () => hideModal(),
      },
      secondary: { show: false },
    });

    const profileResult = await statsSystemRef.current?.loadProfile({ force: true });
    const stats = profileResult?.summary || {};
    const profile = profileResult?.profile || null;

    const fallbackName = me?.username?.trim() ? `@${sanitizeUsername(me.username)}` : me?.name || "Профиль";
    const displayName = profile?.username || fallbackName;
    const avatarSrc = profile?.avatar_url || me?.avatar || "/img/logo.svg";

    const achievements = Array.isArray(profile?.achievements) ? profile.achievements : [];
    const total = achievements.length;
    const unlocked = achievements.filter((item) => item?.unlocked).length;

    const achievementsBlock = (
      <div className="achievements-section">
        <div className="achievements-header">
          <div className="achievements-title">Достижения</div>
          <div className="achievements-counter">{total > 0 ? `${unlocked}/${total}` : "0/0"}</div>
        </div>
        {total === 0 ? (
          <div className="achievements-empty">Достижения появятся после первой игры.</div>
        ) : (
          <div className="achievements-grid">
            {achievements.map((achievement, index) => {
              const percent = clampPercent(Number(achievement?.progress_percent ?? 0));
              const progressText = formatAchievementProgressText(achievement);
              const frameClass = String(achievement?.extra?.frame || "").trim().toLowerCase();
              const cardClasses = ["achievement-card"];
              if (achievement?.unlocked) cardClasses.push("achievement-card--unlocked");

              const frameClasses = ["achievement-frame"];
              if (frameClass) frameClasses.push(`achievement-frame--${frameClass}`);

              const hintText = buildAchievementHint(achievement);

              return (
                <div className={cardClasses.join(" ")} key={`${achievement?.name || "achievement"}-${index}`}>
                  <div className={frameClasses.join(" ")}>
                    {achievement?.image_url ? (
                      <img
                        src={achievement.image_url}
                        alt={achievement?.name || ""}
                        className="achievement-image"
                      />
                    ) : (
                      <span className="achievement-icon">{achievement?.icon || "🏆"}</span>
                    )}
                  </div>
                  <div className="achievement-body">
                    <div className="achievement-row">
                      <div className="achievement-name">{achievement?.name || "Без названия"}</div>
                      <div className="achievement-status">
                        {achievement?.unlocked ? "Получено" : `${percent}%`}
                      </div>
                    </div>
                    <div className="achievement-description">{achievement?.description || ""}</div>
                    <div className="achievement-progress">
                      <div className="achievement-progress-bar">
                        <div className="achievement-progress-fill" style={{ width: `${percent}%` }} />
                      </div>
                      <div className="achievement-progress-text">{progressText}</div>
                    </div>
                    {hintText ? <div className="achievement-hint">{hintText}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );

    const content = (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <img
            src={avatarSrc}
            alt={displayName}
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              objectFit: "cover",
              border: "1px solid var(--line)",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontWeight: 800, fontSize: "16px" }}>{displayName}</div>
            {profile?.updated_at ? (
              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                Обновлено: {formatDate(profile.updated_at)}
              </div>
            ) : null}
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: "8px",
          }}
        >
          {[
            { label: "Игры", value: stats.gamesPlayed },
            { label: "Победы", value: stats.wins },
            { label: "Поражения", value: stats.losses },
            { label: "Ничьи", value: stats.draws },
            { label: "Винрейт", value: `${stats.winRate ?? 0}%` },
          ].map((item) => (
            <div
              key={item.label}
              style={{ border: "1px solid var(--line)", borderRadius: "10px", padding: "10px", textAlign: "center" }}
            >
              <div style={{ fontSize: "12px", color: "var(--muted)" }}>{item.label}</div>
              <div style={{ fontWeight: 800, fontSize: "16px" }}>{item.value ?? 0}</div>
            </div>
          ))}
        </div>
        {achievementsBlock}
        {profileResult?.error ? (
          <div style={{ color: "var(--warn)", fontSize: "12px" }}>
            Не удалось загрузить статистику с сервера. Повторите попытку позже.
          </div>
        ) : !profile && isNumericId(me?.id) ? (
          <div style={{ color: "var(--muted)", fontSize: "12px" }}>
            Сыграйте первую игру, чтобы увидеть статистику.
          </div>
        ) : null}
      </div>
    );

    setModal({
      title: "Профиль",
      content,
      primary: {
        label: "Ок",
        onClick: () => hideModal(),
      },
      secondary: { show: false },
    });
  }, [hideModal, me, setModal]);

  const sendHello = useCallback(() => {
    const currentMe = meRef.current;
    if (!currentMe) return;
    const payload = {
      t: "hello",
      uid: currentMe.id,
      name: currentMe.name,
      username: currentMe.username,
      avatar: currentMe.avatar,
      initData: initData || telegram?.initData || "",
    };
    const fingerprint = JSON.stringify(payload);
    if (fingerprint === lastHelloFingerprintRef.current) return;
    lastHelloFingerprintRef.current = fingerprint;
    sendWs(payload);
  }, [initData, sendWs, telegram]);

  useEffect(() => {
    if (!wsConnectedRef.current) return;
    sendHello();
  }, [initData, me.id, me.name, me.avatar, me.username, sendHello]);

  const onOpen = useCallback(() => {
    wsConnectedRef.current = true;
    lastHelloFingerprintRef.current = "";
    sendHello();
    setStatus({ text: "Онлайн: подключено", blink: false });
    setNavMode("find");
    notifications.success("Подключено к серверу");
    audioManager.playNotification();

    setTimeout(() => {
      if (refreshIdentity()) {
        sendHello();
      }
      if (pendingInviteCode) {
        sendWs({ t: "invite.accept", code: pendingInviteCode });
      }
    }, 120);
  }, [notifications, pendingInviteCode, refreshIdentity, sendHello, sendWs]);

  const onClose = useCallback(() => {
    wsConnectedRef.current = false;
    lastHelloFingerprintRef.current = "";
    setStatus({ text: "Отключено. Переподключение…", blink: true });
    notifications.error("Соединение потеряно");
    setNavMode("find");
  }, [notifications]);

  const onMessage = useCallback(
    (msg) => {
      if (!msg || typeof msg !== "object") return;

      if (msg.t === "online.stats") {
        const total = Number(msg.total);
        const verified = Number(msg.verified);
        const guest = Number(msg.guest);
        setOnlineStats({
          total: Number.isFinite(total) ? total : 0,
          verified: Number.isFinite(verified) ? verified : 0,
          guest: Number.isFinite(guest) ? guest : 0,
        });
        return;
      }

      if (msg.t === "game.start") {
        setScreen("game");
        setPendingInviteCode("");
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          if (url.searchParams.has("ref") || url.searchParams.has("tgWebAppStartParam")) {
            url.searchParams.delete("ref");
            url.searchParams.delete("tgWebAppStartParam");
            window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
          }
        }
        const rawOpp = msg.opp && typeof msg.opp === "object" ? msg.opp : null;
        const incomingOpp = rawOpp
          ? {
              id: rawOpp.id,
              name: typeof rawOpp.name === "string" ? rawOpp.name.trim() : "",
              username: typeof rawOpp.username === "string" ? rawOpp.username.trim() : "",
              avatar: typeof rawOpp.avatar === "string" ? rawOpp.avatar.trim() : "",
            }
          : null;

        setGame((prev) => {
          const updatedOpp = incomingOpp && String(incomingOpp.id) === String(meRef.current.id)
            ? null
            : incomingOpp;
          return {
            ...prev,
            gameId: msg.gameId,
            you: msg.you,
            turn: msg.turn || "X",
            opp: updatedOpp,
            lastOpp: updatedOpp ? { ...updatedOpp } : prev.lastOpp,
            board: Array(9).fill(null),
          };
        });

        setWinLine(null);
        hideModal();
        const myMoveAllowed = msg.you && msg.turn && msg.you === msg.turn;
        setStatus({ text: myMoveAllowed ? "Ваш ход" : "Ход оппонента", blink: false });
        setNavMode("resign");
        notifications.success("Игра началась!");
        audioManager.playNotification();
        statsSystemRef.current?.startGame();
        return;
      }

      if (msg.t === "online.stats") {
        const total = Number(msg.total ?? 0);
        const verified = Number(msg.verified ?? 0);
        const guest = Number(msg.guest ?? 0);
        setOnlineStats({
          total: Number.isFinite(total) ? total : 0,
          verified: Number.isFinite(verified) ? verified : 0,
          guest: Number.isFinite(guest) ? guest : 0,
        });
        return;
      }

      if (msg.t === "queue.joined") {
        setNavMode("waiting");
        setStatus({ text: "Поиск соперника…", blink: true });
        return;
      }

      if (msg.t === "queue.waiting") {
        const position = Number(msg.position ?? 0);
        if (Number.isFinite(position) && position > 0) {
          setStatus({ text: `Поиск соперника… Позиция: ${position}`, blink: true });
        }
        return;
      }

      if (msg.t === "queue.left") {
        if (!gameRef.current.gameId) {
          setScreen("modes");
          setNavMode("find");
          setStatus({ text: "Готово", blink: false });
        }
        return;
      }

      if (msg.t === "queue.throttled") {
        const retryIn = Math.max(0, Math.ceil(Number(msg.retryIn || 0) / 1000));
        notifications.info(`Слишком часто. Повторите через ${retryIn} сек.`);
        return;
      }

      if (msg.t === "invite.created") {
        setStatus({ text: "Ссылка приглашения создана", blink: false });
        const shareMode = pendingInviteShareModeRef.current;
        pendingInviteShareModeRef.current = "link";

        if (shareMode === "code") {
          const inviteCode = typeof msg.code === "string" ? msg.code.trim() : "";
          if (inviteCode) {
            navigator.clipboard?.writeText(inviteCode)
              .then(() => notifications.success("Код лобби скопирован"))
              .catch(() => notifications.info(`Код лобби: ${inviteCode}`));
          } else {
            notifications.error("Не удалось получить код лобби");
          }
        } else {
          shareInviteLink(msg.link);
        }
        return;
      }

      if (msg.t === "invite.waiting") {
        setStatus({ text: "Ожидаем, пока друг откроет ссылку…", blink: true });
        return;
      }

      if (msg.t === "invite.connected") {
        notifications.success("Игрок по приглашению подключился");
        setStatus({ text: "Игрок найден по приглашению", blink: false });
        return;
      }

      if (msg.t === "invite.invalid") {
        const reasonText = {
          not_found: "Приглашение не найдено",
          used: "Приглашение уже использовано",
          expired: "Срок действия приглашения истёк",
          self: "Нельзя принять своё приглашение",
          host_offline: "Игрок не в сети",
          create_failed: "Не удалось создать приглашение",
        };
        const text = reasonText[msg.reason] || "Приглашение недействительно";
        notifications.error(text);
        setStatus({ text, blink: false });
        setPendingInviteCode("");
        return;
      }

      if (msg.t === "game.state") {
        if (Array.isArray(msg.board)) {
          setGame((prev) => ({ ...prev, board: msg.board.slice() }));
        }
        if (msg.turn) {
          setGame((prev) => ({ ...prev, turn: msg.turn }));
        }

        if (msg.win) {
          if (msg.win.line) setWinLine(msg.win.line);
          setNavMode("rematch");

          const youWon = msg.win.by !== null && msg.win.by === gameRef.current.you;
          const youLost = msg.win.by !== null && msg.win.by !== gameRef.current.you;
          const oppLabel = gameRef.current.opp?.name || "оппонент";

          let title = "Ничья 🤝";
          let text = `Сыграли вничью с ${oppLabel}.`;
          let phrasePool = DRAW_PHRASES;

          if (youWon) {
            title = "Победа 🎉";
            text = `Вы обыграли ${oppLabel}.`;
            phrasePool = WIN_PHRASES;
            audioManager.playWin();
            statsSystemRef.current?.endGame("win");
          } else if (youLost) {
            title = "Поражение 😔";
            text = `${oppLabel} выиграл(а).`;
            phrasePool = LOSE_PHRASES;
            audioManager.playLose();
            statsSystemRef.current?.endGame("lose");
          } else {
            audioManager.playDraw();
            statsSystemRef.current?.endGame("draw");
          }

          const modalContent = buildResultContent(text, phrasePool);
          setModal({
            title,
            content: modalContent,
            primary: {
              label: "Реванш",
              onClick: () => {
                hideModal();
                inviteLastOpponent();
              },
            },
            secondary: {
              label: "Выйти",
              onClick: () => {
                toLobby();
                setNavMode("find");
              },
            },
          });

          setStatus({ text: youWon ? "Победа!" : youLost ? "Поражение" : "Ничья", blink: false });
        } else {
          const allowed = gameRef.current.you && gameRef.current.you === msg.turn && gameRef.current.gameId;
          setStatus({ text: allowed ? "Ваш ход" : "Ход оппонента", blink: false });
          if (allowed) audioManager.playMove();
        }
        return;
      }

      if (msg.t === "game.end") {
        setGame((prev) => {
          if (!prev.lastOpp && prev.opp) {
            return { ...prev, lastOpp: { ...prev.opp } };
          }
          return prev;
        });

        const winnerMark = typeof msg.by === "string" ? msg.by : null;
        const youWon = winnerMark && winnerMark === gameRef.current.you;
        const youLost = winnerMark && winnerMark !== gameRef.current.you;

        if (msg.reason === "win" || msg.reason === "draw") {
          setNavMode("rematch");
          return;
        }

        setNavMode("rematch");

        let title = "Игра завершена";
        let mainText = "Игра завершена.";
        let phrases = null;
        let statusText = "Игра завершена";

        if (msg.reason === "resign") {
          if (youWon) {
            title = "Победа 🎉";
            mainText = "Оппонент сдался.";
            phrases = WIN_PHRASES;
            statusText = "Победа!";
            audioManager.playWin();
            statsSystemRef.current?.endGame("win");
          } else if (youLost) {
            title = "Поражение 😔";
            mainText = "Вы сдались.";
            phrases = LOSE_PHRASES;
            statusText = "Поражение";
            audioManager.playLose();
            statsSystemRef.current?.endGame("lose");
          } else {
            mainText = "Игра завершилась сдачей.";
            audioManager.playNotification();
          }
        } else if (msg.reason === "disconnect") {
          if (youWon) {
            title = "Победа 🎉";
            mainText = "Оппонент отключился.";
            phrases = WIN_PHRASES;
            statusText = "Победа!";
            audioManager.playWin();
            statsSystemRef.current?.endGame("win");
          } else if (youLost) {
            title = "Поражение 😔";
            mainText = "Вы были отключены.";
            phrases = LOSE_PHRASES;
            statusText = "Поражение";
            audioManager.playLose();
            statsSystemRef.current?.endGame("lose");
          } else {
            mainText = "Игра завершилась из-за отключения.";
            audioManager.playNotification();
          }
        } else {
          if (youWon) {
            title = "Победа 🎉";
            mainText = "Вы победили!";
            phrases = WIN_PHRASES;
            statusText = "Победа!";
            statsSystemRef.current?.endGame("win");
          } else if (youLost) {
            title = "Поражение 😔";
            mainText = "Вы проиграли.";
            phrases = LOSE_PHRASES;
            statusText = "Поражение";
            statsSystemRef.current?.endGame("lose");
          }
        }

        const modalContent = buildResultContent(mainText, phrases);
        setModal({
          title,
          content: modalContent,
          primary: {
            label: "Реванш",
            onClick: () => {
              hideModal();
              inviteLastOpponent();
            },
          },
          secondary: {
            label: "Выйти",
            onClick: () => {
              toLobby();
              setNavMode("find");
            },
          },
        });

        setStatus({ text: statusText, blink: false });
        return;
      }

      if (msg.t === "rematch.offer" && msg.from) {
        if (String(msg.from.id) === String(meRef.current.id)) return;
        setGame((prev) => ({
          ...prev,
          lastOpp: {
            id: msg.from.id,
            name: msg.from.name,
            username: msg.from.username || "",
            avatar: msg.from.avatar,
          },
        }));
        setModal({
          title: "Реванш",
          content: `${msg.from.name || "Оппонент"} предлагает реванш!`,
          primary: {
            label: "Принять",
            onClick: () => {
              hideModal();
              acceptRematch(msg.from.id);
            },
          },
          secondary: {
            label: "Отказаться",
            onClick: () => {
              hideModal();
              declineRematch(msg.from.id);
              setNavMode("find");
            },
          },
        });
        audioManager.playNotification();
        return;
      }

      if (msg.t === "rematch.declined") {
        setModal({
          title: "Реванш отклонён",
          content: "Соперник отказался от реванша. Вы возвращены в лобби.",
          primary: {
            label: "Ок",
            onClick: () => {
              toLobby();
              setNavMode("find");
            },
          },
          secondary: { show: false },
        });
      }
    },
    [
      acceptRematch,
      declineRematch,
      hideModal,
      inviteLastOpponent,
      notifications,
      setModal,
      shareInviteLink,
      toLobby,
    ]
  );

  const { send: sendWsRaw } = useWebSocket({
    url: wsUrl,
    onOpen,
    onMessage,
    onClose,
  });

  useEffect(() => {
    sendRef.current = sendWsRaw;
  }, [sendWsRaw]);

  useEffect(() => {
    if (!game.opp || !game.opp.id) return;

    const id = normalizeId(game.opp.id);
    if (!isNumericId(id)) return;
    if (!needsOpponentDetails(game.opp)) return;
    if (pendingOppProfiles.current.has(id)) return;

    pendingOppProfiles.current.add(id);

    fetch(apiUrl(`/profile/${encodeURIComponent(id)}`), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        const profile = data?.profile || null;
        if (!profile) return;
        if (!gameRef.current.opp || normalizeId(gameRef.current.opp.id) !== id) return;

        const avatar = typeof profile.avatar_url === "string" ? profile.avatar_url.trim() : "";
        const usernameRaw = typeof profile.username === "string" ? profile.username.trim() : "";
        const username = usernameRaw.replace(/^@/, "");

        setGame((prev) => {
          if (!prev.opp || normalizeId(prev.opp.id) !== id) return prev;
          const updatedOpp = {
            ...prev.opp,
            avatar: avatar || prev.opp.avatar || "",
            username: username || prev.opp.username || "",
          };
          return {
            ...prev,
            opp: updatedOpp,
            lastOpp: prev.lastOpp ? { ...prev.lastOpp, ...updatedOpp } : updatedOpp,
          };
        });
      })
      .catch((error) => {
        console.warn("Не удалось загрузить профиль соперника", error);
      })
      .finally(() => {
        pendingOppProfiles.current.delete(id);
      });
  }, [game.opp]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") hideModal();
      if (event.key === " " && !gameRef.current.gameId) {
        event.preventDefault();
        startQueueSearch({ notify: true, playSound: false });
      }
    };

    const handleVisibilityChange = () => {
      document.body.style.animationPlayState = document.hidden ? "paused" : "running";
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hideModal, startQueueSearch]);

  const gameView = {
    ...game,
    myMoveAllowed: Boolean(game.you && game.you === game.turn && game.gameId),
  };

  const modeCards = [
    {
      id: "online",
      emoji: "🌐",
      title: "Играть онлайн",
      description: "Быстрый матч через общую очередь игроков.",
      onCardClick: handlePlayOnline,
    },
    {
      id: "friends",
      emoji: "🧑‍🤝‍🧑",
      title: "Играть с друзьями",
      description: "Создайте лобби или подключитесь по коду приглашения.",
      renderBody: "friends",
    },
    {
      id: "computer",
      emoji: "🤖",
      title: "Играть с компьютером",
      description: "Режим против бота (временная заглушка).",
      onCardClick: openComputerStub,
    },
  ];

  const isModesScreen = !game.gameId && screen === "modes";

  return (
    <div id="app">
      <Board
        me={me}
        game={gameView}
        statusText={status}
        winLine={winLine}
        onCellClick={handleCellClick}
        onAuthorClick={handleAuthorClick}
        boardContent={
          isModesScreen ? (
            <GameModesCarousel
              items={modeCards}
              activeIndex={activeModeIndex}
              onChange={setActiveModeIndex}
              friendsActions={{
                onCreate: () => createInvite({ share: "code" }),
                onJoin: (code) => {
                  sendWs({ t: "invite.accept", code });
                  setScreen("game");
                  setStatus({ text: "Подключаем к лобби друга…", blink: true });
                  audioManager.playClick();
                },
              }}
            />
          ) : null
        }
      />
      <Nav
        mode={navMode}
        onAction={onNavAction}
        onRating={loadRating}
        onProfile={loadProfile}
        onInvite={createInvite}
        onlineStats={onlineStats}
      />
      <Modal
        open={modalState.open}
        title={modalState.title}
        content={modalState.content}
        primary={modalState.primary}
        secondary={modalState.secondary}
      />
      <Notifications items={notifications.notifications} onClose={notifications.remove} />
    </div>
  );
}
