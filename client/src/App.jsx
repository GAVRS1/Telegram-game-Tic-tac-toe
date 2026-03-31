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
import {
  isNumericId,
  normalizeId,
  sanitizeUsername,
} from "./utils/identity.js";
import { apiUrl, resolveWsUrl } from "./utils/network.js";
import { parseStartPayload } from "./utils/startPayload.js";

const WIN_PHRASES = [
  "Поздравляем! Вы сыграли мощно.",
  "Отличная победа! Так держать.",
  "Браво! Красиво переиграли соперника.",
  "Победа за вами! Скилл на месте.",
];
const LOSE_PHRASES = [
  "Ничего страшного, получится в следующий раз.",
  "Хорошая попытка! Ещё немного — и победа будет ваша.",
  "Не сдавайтесь — следующий матч за вами.",
  "Сильная игра! Чуть-чуть не хватило, но всё впереди.",
];
const DRAW_PHRASES = [
  "Отличный матч! Вы держались на равных.",
  "Крутая заруба — никто не уступил.",
  "Это была достойная ничья. До новой встречи!",
  "Ни шагу назад! Равная борьба до конца.",
];

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const BOT_STRATEGIES = {
  random: "Случайный",
  defensive: "Оборонительный",
  adaptive: "Адаптивный",
};

const initialGameState = {
  gameId: null,
  you: null,
  turn: "X",
  board: Array(9).fill(null),
  opp: null,
  lastOpp: null,
  roundWinsX: 0,
  roundWinsO: 0,
  roundNumber: 1,
  matchTargetWins: 3,
};

const initialBotState = {
  active: false,
  strategy: "random",
  playerMark: "X",
  botMark: "O",
  playerMoves: [],
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
  const blocks = [
    <p key="main" className="modal-text">
      {String(baseText ?? "")}
    </p>,
  ];
  const extra =
    Array.isArray(phrasesPool) && phrasesPool.length ? pick(phrasesPool) : null;
  if (extra)
    blocks.push(
      <p key="extra" className="modal-phrase">
        {extra}
      </p>,
    );
  return blocks;
}

function getWinner(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { mark: board[a], line };
    }
  }

  if (board.every(Boolean)) return { mark: null, line: null };
  return null;
}

function getFinishingMove(board, mark) {
  for (const line of WIN_LINES) {
    const values = line.map((index) => board[index]);
    const markCount = values.filter((value) => value === mark).length;
    const emptyIndex = line.find((index) => !board[index]);
    if (markCount === 2 && emptyIndex !== undefined) return emptyIndex;
  }
  return null;
}

function pickRandomMove(board) {
  const free = board
    .map((value, index) => (!value ? index : null))
    .filter((value) => value !== null);
  if (!free.length) return null;
  return free[Math.floor(Math.random() * free.length)];
}

function pickAdaptiveMove(board, playerMoves, botMark, playerMark) {
  const center = 4;
  if (!board[center]) return center;

  const corners = [0, 2, 6, 8];
  const sideCells = [1, 3, 5, 7];

  const lastPlayerMove = playerMoves[playerMoves.length - 1];
  if (lastPlayerMove === center) {
    const freeCorner = corners.find((index) => !board[index]);
    if (freeCorner !== undefined) return freeCorner;
  }

  const oppositeCornerMap = { 0: 8, 2: 6, 6: 2, 8: 0 };
  for (const move of playerMoves) {
    const opposite = oppositeCornerMap[move];
    if (typeof opposite === "number" && !board[opposite]) return opposite;
  }

  for (const corner of corners) {
    if (!board[corner]) return corner;
  }

  for (const side of sideCells) {
    if (!board[side]) return side;
  }

  return (
    getFinishingMove(board, botMark) ??
    getFinishingMove(board, playerMark) ??
    pickRandomMove(board)
  );
}

function needsOpponentDetails(opp) {
  if (!opp) return false;
  const hasAvatar = typeof opp.avatar === "string" && opp.avatar.trim() !== "";
  const hasUsername =
    typeof opp.username === "string" && opp.username.trim() !== "";
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
    const minGames =
      Number(
        achievement?.details?.minGames ?? achievement?.extra?.min_games ?? 0,
      ) || 0;
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

const RATING_METRICS = [
  { key: "wins", label: "Победы", valueLabel: "Победы", iconType: "trophy" },
  { key: "coins", label: "Монеты", valueLabel: "Монет", iconType: "coin" },
  {
    key: "achievements",
    label: "Достижения",
    valueLabel: "Открыто достижений",
    iconType: "medal",
  },
  {
    key: "invites",
    label: "Приглашения",
    valueLabel: "Приглашено друзей",
    iconType: "handshake",
  },
];
const ICON_PATHS = {
  coin: "/img/coin.svg",
  trophy: "/img/trophy.svg",
  medal: "/img/medal.svg",
  handshake: "/img/handshake.svg",
  achievement: "/img/default-achievement.svg",
};

function resolveIconPath(iconType) {
  const raw = String(iconType ?? "").trim();
  if (!raw) return ICON_PATHS.achievement;
  if (raw.startsWith("/") || raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }
  return ICON_PATHS[raw] || ICON_PATHS.achievement;
}

function getRatingMetricConfig(metric) {
  return (
    RATING_METRICS.find((item) => item.key === metric) || RATING_METRICS[0]
  );
}

function renderMetricIcon(iconType, className = "metric-icon") {
  return (
    <img
      src={resolveIconPath(iconType)}
      alt=""
      aria-hidden="true"
      className={`coin-icon ${className}`.trim()}
    />
  );
}

function resolveStartParamFromLocation() {
  if (typeof window === "undefined") return "";

  try {
    const params = new URLSearchParams(window.location.search);
    const directRef = params.get("ref")?.trim();
    if (directRef) return `ref_${directRef}`;

    const telegramStart = params.get("tgWebAppStartParam")?.trim();
    if (telegramStart) return telegramStart;
  } catch {}

  const tg = window.Telegram?.WebApp;
  const startParam = tg?.initDataUnsafe?.start_param;
  return typeof startParam === "string" ? startParam.trim() : "";
}

function resolveInviteCodeFromLocation() {
  const parsed = parseStartPayload(resolveStartParamFromLocation());
  if (parsed.kind === "lobby_invite") return parsed.inviteCode;
  if (parsed.kind === "unknown") return parsed.raw;
  return "";
}

export default function App() {
  const { telegram, initData, me, refreshIdentity, meRef } = useTelegramAuth();
  const [game, setGame] = useState(initialGameState);
  const [status, setStatus] = useState({ text: "Готово", blink: false });
  const [screen, setScreen] = useState("modes");
  const [isViewEntering, setIsViewEntering] = useState(true);
  const [activeModeIndex, setActiveModeIndex] = useState(0);
  const [friendInviteInputVisible, setFriendInviteInputVisible] =
    useState(false);
  const [friendInviteInput, setFriendInviteInput] = useState("");
  const [lobbyInviteCode, setLobbyInviteCode] = useState("");
  const [isFriendsLobbyState, setIsFriendsLobbyState] = useState(false);
  const [navMode, setNavMode] = useState("find");
  const [onlineStats, setOnlineStats] = useState({
    total: 0,
    verified: 0,
    guest: 0,
  });
  const [coinBalance, setCoinBalance] = useState(0);
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
  const [botState, setBotState] = useState(initialBotState);

  const gameRef = useRef(game);
  const sendRef = useRef(() => {});
  const wsConnectedRef = useRef(false);
  const lastHelloFingerprintRef = useRef("");
  const pendingOppProfiles = useRef(new Set());
  const pendingInviteShareModeRef = useRef("link");
  const statsSystemRef = useRef(null);
  const mountedRef = useRef(true);
  const botTimeoutRef = useRef(null);

  const notifications = useNotifications();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (botTimeoutRef.current) {
        clearTimeout(botTimeoutRef.current);
        botTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    setIsViewEntering(true);
    const timer = window.setTimeout(() => {
      setIsViewEntering(false);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [screen]);

  useEffect(() => {
    if (pendingInviteCode) return;
    const nextCode = resolveInviteCodeFromLocation();
    if (nextCode) setPendingInviteCode(nextCode);
  }, [pendingInviteCode, telegram, initData]);

  useEffect(() => {
    statsSystemRef.current = new StatsSystem(() => meRef.current);
  }, [meRef]);

  useEffect(() => {
    let cancelled = false;
    const syncBalance = async () => {
      const profileResult = await statsSystemRef.current?.loadProfile({
        force: false,
      });
      if (cancelled) return;
      const nextBalance = Number(profileResult?.profile?.coins_balance ?? 0);
      setCoinBalance(nextBalance);
    };

    syncBalance().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [me?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const root = document.documentElement;
    const tg = telegram || window.Telegram?.WebApp || null;

    const syncViewportSize = () => {
      const stableHeight = Number(tg?.viewportStableHeight);
      const dynamicHeight = Number(tg?.viewportHeight);
      const nextHeight =
        Number.isFinite(stableHeight) && stableHeight > 0
          ? stableHeight
          : Number.isFinite(dynamicHeight) && dynamicHeight > 0
            ? dynamicHeight
            : window.innerHeight;

      root.style.setProperty("--tg-viewport-height", `${nextHeight}px`);
      root.style.setProperty("--tg-viewport-width", `${window.innerWidth}px`);
    };

    syncViewportSize();
    window.addEventListener("resize", syncViewportSize, { passive: true });

    try {
      tg?.onEvent?.("viewportChanged", syncViewportSize);
      tg?.onEvent?.("viewport_changed", syncViewportSize);
    } catch {}

    return () => {
      window.removeEventListener("resize", syncViewportSize);
      try {
        tg?.offEvent?.("viewportChanged", syncViewportSize);
        tg?.offEvent?.("viewport_changed", syncViewportSize);
      } catch {}
    };
  }, [telegram]);

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
          notifications.success(
            "Окно Telegram для отправки приглашения открыто",
          );
          return;
        }
      } catch {}

      try {
        await navigator.clipboard?.writeText(link);
        notifications.success("Ссылка скопирована в буфер обмена");
      } catch {
        notifications.info(
          "Ссылка приглашения готова: отправьте её другу в Telegram",
        );
      }
    },
    [notifications, telegram],
  );

  const createInvite = useCallback(() => {
    setLobbyInviteCode("");
    setScreen("modes");
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
      setScreen("modes");
      sendWs({ t: "queue.join" });
      setNavMode("waiting");
      setStatus({ text: "Поиск соперника…", blink: true });
      if (notify) notifications.info("Поиск соперника…");
      if (playSound) audioManager.playClick();
    },
    [notifications, sendWs],
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
    [notifications, sendWs],
  );

  const inviteLastOpponent = useCallback(() => {
    const lastOpp = gameRef.current.lastOpp;
    if (!lastOpp?.id) {
      startQueueSearch({ notify: false, playSound: false });
      return;
    }
    setStatus({ text: "Отправлено приглашение на реванш…", blink: true });
    notifications.info("Приглашение отправлено");
    sendWs({
      t: "rematch.offer",
      to: lastOpp.id,
      prevGameId: gameRef.current.gameId || null,
    });
    audioManager.playClick();
  }, [notifications, sendWs, startQueueSearch]);

  const acceptRematch = useCallback(
    (fromId) => {
      setStatus({ text: "Подтверждение реванша…", blink: false });
      sendWs({ t: "rematch.accept", to: fromId });
      audioManager.playClick();
    },
    [sendWs],
  );

  const toLobby = useCallback(
    (options = {}) => {
      const { isFriendsFlow = false } = options;
      if (botTimeoutRef.current) {
        clearTimeout(botTimeoutRef.current);
        botTimeoutRef.current = null;
      }
      setGame((prev) => ({
        ...prev,
        gameId: null,
        you: null,
        turn: "X",
        board: Array(9).fill(null),
        opp: null,
        roundWinsX: 0,
        roundWinsO: 0,
        roundNumber: 1,
        matchTargetWins: 3,
      }));
      setBotState(initialBotState);
      setWinLine(null);
      hideModal();
      setScreen("modes");
      setStatus({ text: "Готово", blink: false });
      if (!isFriendsFlow) {
        setLobbyInviteCode("");
        setIsFriendsLobbyState(false);
      }
      sendWs({ t: "queue.leave" });
    },
    [hideModal, sendWs],
  );

  const handlePlayOnline = useCallback(() => {
    setLobbyInviteCode("");
    setIsFriendsLobbyState(false);
    startQueueSearch();
  }, [startQueueSearch]);

  const createFriendsLobby = useCallback(() => {
    pendingInviteShareModeRef.current = "code";
    setIsFriendsLobbyState(true);
    setFriendInviteInputVisible(false);
    setFriendInviteInput("");
    createInvite();
  }, [createInvite]);

  const joinFriendsLobby = useCallback(() => {
    setIsFriendsLobbyState(true);
    const code = friendInviteInput.trim();
    if (!code) {
      notifications.info("Введите код приглашения");
      return;
    }
    sendWs({ t: "invite.accept", code });
    setStatus({ text: "Подключаем к лобби друга…", blink: true });
    audioManager.playClick();
  }, [friendInviteInput, notifications, sendWs]);

  const startComputerGame = useCallback(() => {
    setLobbyInviteCode("");
    setIsFriendsLobbyState(false);
    setFriendInviteInputVisible(false);
    setFriendInviteInput("");
    const strategies = Object.keys(BOT_STRATEGIES);
    const strategy =
      strategies[Math.floor(Math.random() * strategies.length)] || "random";
    const playerMark = "X";
    const botMark = "O";

    if (botTimeoutRef.current) {
      clearTimeout(botTimeoutRef.current);
      botTimeoutRef.current = null;
    }

    setWinLine(null);
    setStatus({ text: "Ваш ход", blink: false });
    setGame((prev) => ({
      ...prev,
      turn: playerMark,
      board: Array(9).fill(null),
      roundWinsX: 0,
      roundWinsO: 0,
      roundNumber: 1,
    }));

    setBotState({
      active: true,
      strategy,
      playerMark,
      botMark,
      playerMoves: [],
    });
    setScreen("game");
    setNavMode("resign");
    setGame((prev) => ({
      ...prev,
      gameId: "local-bot",
      you: playerMark,
      turn: playerMark,
      board: Array(9).fill(null),
      opp: {
        id: "bot",
        name: "Компьютер",
        username: "bot",
        avatar: "/img/logo.svg",
      },
      lastOpp: {
        id: "bot",
        name: "Компьютер",
        username: "bot",
        avatar: "/img/logo.svg",
      },
      roundWinsX: 0,
      roundWinsO: 0,
      roundNumber: 1,
      matchTargetWins: 3,
    }));
  }, []);

  const finishComputerMatch = useCallback(
    (result, board, line = null) => {
      setWinLine(line);
      setNavMode("find");

      let title = "Ничья";
      let text = "Матч с компьютером завершился ничьей.";
      let phrasePool = DRAW_PHRASES;
      let statusText = "Ничья";

      if (result === "win") {
        title = "Победа в серии";
        text = "Вы выиграли серию у компьютера.";
        phrasePool = WIN_PHRASES;
        statusText = "Победа в серии!";
        audioManager.playWin();
      } else if (result === "lose") {
        title = "Поражение в серии";
        text = "Компьютер выиграл серию.";
        phrasePool = LOSE_PHRASES;
        statusText = "Поражение в серии";
        audioManager.playLose();
      } else {
        audioManager.playDraw();
      }

      setStatus({ text: statusText, blink: false });
      setModal({
        title,
        content: buildResultContent(text, phrasePool),
        primary: {
          label: "Сыграть снова",
          onClick: () => {
            hideModal();
            startComputerGame();
          },
        },
        secondary: {
          label: "Выйти",
          onClick: () => {
            hideModal();
            toLobby();
            setBotState(initialBotState);
          },
        },
      });

      if (board) {
        setGame((prev) => ({ ...prev, board: board.slice(), turn: null }));
      }
    },
    [hideModal, startComputerGame, toLobby],
  );

  const finishComputerRound = useCallback(
    (result, board, line = null) => {
      const currentGame = gameRef.current;
      const playerMark = botState.playerMark || "X";
      const botMark = botState.botMark || "O";
      const targetWins = Number(currentGame?.matchTargetWins ?? 3) || 3;
      const currentWinsX = Number(currentGame?.roundWinsX ?? 0) || 0;
      const currentWinsO = Number(currentGame?.roundWinsO ?? 0) || 0;
      const currentRound = Number(currentGame?.roundNumber ?? 1) || 1;

      const winnerMark =
        result === "win" ? playerMark : result === "lose" ? botMark : null;
      const nextWinsX = currentWinsX + (winnerMark === "X" ? 1 : 0);
      const nextWinsO = currentWinsO + (winnerMark === "O" ? 1 : 0);

      setWinLine(line);
      setGame((prev) => ({
        ...prev,
        board: board ? board.slice() : prev.board,
        turn: null,
        roundWinsX: nextWinsX,
        roundWinsO: nextWinsO,
      }));

      const playerSeriesWins = playerMark === "X" ? nextWinsX : nextWinsO;
      const botSeriesWins = botMark === "X" ? nextWinsX : nextWinsO;

      if (playerSeriesWins >= targetWins) {
        finishComputerMatch("win", board, line);
        return;
      }
      if (botSeriesWins >= targetWins) {
        finishComputerMatch("lose", board, line);
        return;
      }

      let title = "Ничья в раунде";
      let text = `Раунд ${currentRound} завершился ничьей.`;
      let statusText = "Ничья в раунде";

      if (result === "win") {
        title = "Раунд за вами";
        text = `Вы выиграли раунд ${currentRound}.`;
        statusText = "Раунд выигран!";
        audioManager.playWin();
      } else if (result === "lose") {
        title = "Раунд за компьютером";
        text = `Компьютер выиграл раунд ${currentRound}.`;
        statusText = "Раунд проигран";
        audioManager.playLose();
      } else {
        audioManager.playDraw();
      }

      setStatus({ text: statusText, blink: false });
      setModal({
        title,
        content: (
          <>
            <p className="modal-text">{text}</p>
            <p className="modal-phrase">
              Счёт серии: {playerSeriesWins}:{botSeriesWins} (до {targetWins})
            </p>
          </>
        ),
        primary: {
          label: "Следующий раунд",
          onClick: () => {
            hideModal();
            setWinLine(null);
            setStatus({ text: "Ваш ход", blink: false });
            setGame((prev) => ({
              ...prev,
              board: Array(9).fill(null),
              turn: playerMark,
              roundNumber: (Number(prev.roundNumber ?? 1) || 1) + 1,
            }));
            setNavMode("resign");
            setBotState((prev) => ({ ...prev, playerMoves: [] }));
          },
        },
        secondary: {
          label: "Выйти",
          onClick: () => {
            hideModal();
            toLobby();
            setBotState(initialBotState);
          },
        },
      });
    },
    [botState.botMark, botState.playerMark, finishComputerMatch, hideModal, toLobby],
  );

  const finishComputerGame = useCallback(
    (result, board, line = null) => {
      finishComputerRound(result, board, line);
    },
    [finishComputerRound],
  );

  const declineRematch = useCallback(
    (fromId) => {
      setStatus({ text: "Готово", blink: false });
      sendWs({ t: "rematch.decline", to: fromId });
      toLobby();
      audioManager.playClick();
    },
    [sendWs, toLobby],
  );

  const onNavAction = useCallback(
    (mode) => {
      const localBotActive = botState.active;
      if (mode === "find") {
        if (localBotActive) {
          startComputerGame();
          return;
        }
        startQueueSearch();
      }
      if (mode === "waiting") {
        if (localBotActive) {
          toLobby();
          setBotState(initialBotState);
          return;
        }
        cancelQueueSearch();
      }
      if (mode === "resign") {
        if (localBotActive) {
          finishComputerGame("lose", gameRef.current.board);
          return;
        }
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
      if (mode === "rematch") {
        if (localBotActive) {
          startComputerGame();
          return;
        }
        inviteLastOpponent();
      }
    },
    [
      botState.active,
      cancelQueueSearch,
      finishComputerGame,
      hideModal,
      inviteLastOpponent,
      sendWs,
      setModal,
      startComputerGame,
      startQueueSearch,
      toLobby,
    ],
  );

  const handleCellClick = useCallback(
    (index) => {
      const currentGame = gameRef.current;
      if (!currentGame.gameId) return;

      if (botState.active) {
        const board = Array.isArray(currentGame.board)
          ? currentGame.board.slice()
          : Array(9).fill(null);
        if (currentGame.turn !== botState.playerMark || board[index]) return;

        vibrate(10);
        audioManager.playClick();
        board[index] = botState.playerMark;
        const nextPlayerMoves = [...botState.playerMoves, index];
        setBotState((prev) => ({ ...prev, playerMoves: nextPlayerMoves }));
        setGame((prev) => ({
          ...prev,
          board: board.slice(),
          turn: botState.botMark,
        }));

        const playerResult = getWinner(board);
        if (playerResult) {
          if (playerResult.mark === botState.playerMark) {
            finishComputerGame("win", board, playerResult.line);
          } else {
            finishComputerGame("draw", board, null);
          }
          return;
        }

        setStatus({ text: "Ход компьютера", blink: true });

        if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
        botTimeoutRef.current = setTimeout(() => {
          const currentBoard = gameRef.current.board.slice();
          if (!botState.active || gameRef.current.turn !== botState.botMark)
            return;

          let botMove = null;
          if (botState.strategy === "defensive") {
            botMove =
              getFinishingMove(currentBoard, botState.botMark) ??
              getFinishingMove(currentBoard, botState.playerMark) ??
              pickRandomMove(currentBoard);
          } else if (botState.strategy === "adaptive") {
            botMove =
              getFinishingMove(currentBoard, botState.botMark) ??
              getFinishingMove(currentBoard, botState.playerMark) ??
              pickAdaptiveMove(
                currentBoard,
                nextPlayerMoves,
                botState.botMark,
                botState.playerMark,
              );
          } else {
            botMove = pickRandomMove(currentBoard);
          }

          if (botMove === null || botMove === undefined) {
            finishComputerGame("draw", currentBoard, null);
            return;
          }

          currentBoard[botMove] = botState.botMark;
          setGame((prev) => ({
            ...prev,
            board: currentBoard.slice(),
            turn: botState.playerMark,
          }));

          const botResult = getWinner(currentBoard);
          if (botResult) {
            if (botResult.mark === botState.botMark)
              finishComputerGame("lose", currentBoard, botResult.line);
            else finishComputerGame("draw", currentBoard, null);
            return;
          }

          setStatus({ text: "Ваш ход", blink: false });
          audioManager.playMove();
        }, 450);
        return;
      }

      const myMoveAllowed =
        currentGame.you &&
        currentGame.you === currentGame.turn &&
        currentGame.gameId;
      if (!myMoveAllowed || currentGame.board[index]) return;

      vibrate(10);
      audioManager.playClick();
      statsSystemRef.current?.recordMove(index);
      sendWs({ t: "game.move", gameId: currentGame.gameId, i: index });
    },
    [botState, finishComputerGame, sendWs],
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

  const loadRating = useCallback(
    async (metric = "wins") => {
      const metricConfig = getRatingMetricConfig(metric);

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
        const response = await fetch(
          apiUrl(`/leaders?metric=${encodeURIComponent(metricConfig.key)}`),
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const rows = Array.isArray(data?.leaders) ? data.leaders : [];
        const selectedMetric = getRatingMetricConfig(
          data?.metric || metricConfig.key,
        );

        const metricValue = (user) => {
          if (selectedMetric.key === "achievements")
            return Number(user.achievements_unlocked ?? 0);
          if (selectedMetric.key === "invites")
            return Number(user.invites_count ?? 0);
          if (selectedMetric.key === "coins")
            return Number(user.coins_balance ?? 0);
          return Number(user.wins ?? 0);
        };

        const content = (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              maxHeight: "50vh",
              overflow: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: "4px",
              }}
            >
              {RATING_METRICS.map((item) => {
                const active = selectedMetric.key === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`btn ${active ? "primary" : ""}`}
                    style={{ padding: "6px 10px", minHeight: "32px" }}
                    onClick={() => loadRating(item.key)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--muted)",
                marginBottom: "4px",
              }}
            >
              Тип рейтинга:{" "}
              <b style={{ color: "var(--text)" }}>{selectedMetric.label}</b> •
              Метрика: {selectedMetric.valueLabel}
            </div>
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
                  <div
                    style={{
                      width: "24px",
                      textAlign: "right",
                      fontWeight: 700,
                    }}
                  >
                    {index + 1}
                  </div>
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
                  <div
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
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
                    <div style={{ fontWeight: 700, color: "var(--text)" }}>
                      {renderMetricIcon(selectedMetric.iconType)} {metricValue(user)} ·{" "}
                      {selectedMetric.valueLabel}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {renderMetricIcon("coin")} {Number(user.coins_balance ?? 0)} | {renderMetricIcon("medal")}{" "}
                      {Number(user.win_rate ?? 0)}%
                    </div>
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
    },
    [hideModal, setModal],
  );

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

    const profileResult = await statsSystemRef.current?.loadProfile({
      force: true,
    });
    const stats = profileResult?.summary || {};
    const profile = profileResult?.profile || null;
    setCoinBalance(Number(profile?.coins_balance ?? 0));

    const fallbackName = me?.username?.trim()
      ? `@${sanitizeUsername(me.username)}`
      : me?.name || "Профиль";
    const displayName = profile?.username || fallbackName;
    const avatarSrc = profile?.avatar_url || me?.avatar || "/img/logo.svg";

    const achievements = Array.isArray(profile?.achievements)
      ? profile.achievements
      : [];
    const total = achievements.length;
    const unlocked = achievements.filter((item) => item?.unlocked).length;
    const invitedUsers = Array.isArray(profile?.invited_users)
      ? profile.invited_users
      : [];
    const invitedCount = Number(
      profile?.invited_count ?? invitedUsers.length ?? 0,
    );
    const referralLink =
      typeof profile?.ref_link === "string" ? profile.ref_link.trim() : "";

    const handleCopyReferralLink = async () => {
      if (!referralLink) {
        notifications.info("Реферальная ссылка пока недоступна.");
        return;
      }
      try {
        await navigator.clipboard?.writeText(referralLink);
        notifications.success("Реферальная ссылка скопирована");
      } catch {
        notifications.info(
          "Не удалось скопировать ссылку. Скопируйте её вручную.",
        );
      }
    };

    const handleShareReferralLink = async () => {
      if (!referralLink) {
        notifications.info("Реферальная ссылка пока недоступна.");
        return;
      }
      await shareInviteLink(referralLink);
    };

    const achievementsBlock = (
      <div className="achievements-section">
        <div className="achievements-header">
          <div className="achievements-title">Достижения</div>
          <div className="achievements-counter">
            {total > 0 ? `${unlocked}/${total}` : "0/0"}
          </div>
        </div>
        {total === 0 ? (
          <div className="achievements-empty">
            Достижения появятся после первой игры.
          </div>
        ) : (
          <div className="achievements-grid">
            {achievements.map((achievement, index) => {
              const percent = clampPercent(
                Number(achievement?.progress_percent ?? 0),
              );
              const progressText = formatAchievementProgressText(achievement);
              const frameClass = String(achievement?.extra?.frame || "")
                .trim()
                .toLowerCase();
              const cardClasses = ["achievement-card"];
              if (achievement?.unlocked)
                cardClasses.push("achievement-card--unlocked");

              const frameClasses = ["achievement-frame"];
              if (frameClass)
                frameClasses.push(`achievement-frame--${frameClass}`);

              const hintText = buildAchievementHint(achievement);

              const achievementIconSrc = achievement?.image_url
                ? achievement.image_url
                : resolveIconPath(achievement?.icon);

              return (
                <div
                  className={cardClasses.join(" ")}
                  key={`${achievement?.name || "achievement"}-${index}`}
                >
                  <div className={frameClasses.join(" ")}>
                    <img
                      src={achievementIconSrc}
                      alt={achievement?.name || "Достижение"}
                      className="achievement-image"
                    />
                  </div>
                  <div className="achievement-body">
                    <div className="achievement-row">
                      <div className="achievement-name">
                        {achievement?.name || "Без названия"}
                      </div>
                      <div className="achievement-status">
                        {achievement?.unlocked ? "Получено" : `${percent}%`}
                      </div>
                    </div>
                    <div className="achievement-description">
                      {achievement?.description || ""}
                    </div>
                    <div className="achievement-progress">
                      <div className="achievement-progress-bar">
                        <div
                          className="achievement-progress-fill"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <div className="achievement-progress-text">
                        {progressText}
                      </div>
                    </div>
                    {hintText ? (
                      <div className="achievement-hint">{hintText}</div>
                    ) : null}
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
            <div style={{ fontWeight: 800, fontSize: "16px" }}>
              {displayName}
            </div>
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
              style={{
                border: "1px solid var(--line)",
                borderRadius: "10px",
                padding: "10px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                {item.label}
              </div>
              <div style={{ fontWeight: 800, fontSize: "16px" }}>
                {item.value ?? 0}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: "10px",
            padding: "10px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>
              Ваша реферальная ссылка
            </div>
            {referralLink ? (
              <div style={{ wordBreak: "break-all", fontSize: "13px" }}>
                {referralLink}
              </div>
            ) : (
              <div style={{ fontSize: "13px", color: "var(--muted)" }}>
                Ссылка появится после загрузки профиля.
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn"
                onClick={handleCopyReferralLink}
              >
                Copy
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleShareReferralLink}
              >
                Share
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>
              Приглашено друзей
            </div>
            <div style={{ fontWeight: 800, fontSize: "18px" }}>
              {Number.isFinite(invitedCount) ? invitedCount : 0}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>
              Список приглашённых
            </div>
            {invitedUsers.length === 0 ? (
              <div style={{ fontSize: "13px", color: "var(--muted)" }}>
                Пока никого не приглашено. Поделитесь ссылкой с друзьями, чтобы
                увидеть их здесь.
              </div>
            ) : (
              invitedUsers.map((invitedUser) => {
                const username =
                  typeof invitedUser?.username === "string" &&
                  invitedUser.username.trim()
                    ? invitedUser.username
                    : `ID ${invitedUser?.id ?? ""}`;
                return (
                  <div
                    key={`${invitedUser?.id || "unknown"}-${invitedUser?.created_at || "date"}`}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: "10px",
                      padding: "8px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <img
                      src={invitedUser?.avatar_url || "/img/logo.svg"}
                      alt={username}
                      style={{
                        width: "30px",
                        height: "30px",
                        borderRadius: "50%",
                        objectFit: "cover",
                        border: "1px solid var(--line)",
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {username}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                        Приглашён:{" "}
                        {formatDate(invitedUser?.created_at) ||
                          "дата неизвестна"}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
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
  }, [hideModal, me, notifications, setModal, shareInviteLink]);

  const sendHello = useCallback(() => {
    const currentMe = meRef.current;
    if (!currentMe) return;
    const startParam = resolveStartParamFromLocation();
    const payload = {
      t: "hello",
      uid: currentMe.id,
      name: currentMe.name,
      username: currentMe.username,
      avatar: currentMe.avatar,
      initData: initData || telegram?.initData || "",
      startParam,
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
        if (botTimeoutRef.current) {
          clearTimeout(botTimeoutRef.current);
          botTimeoutRef.current = null;
        }
        setBotState(initialBotState);
        setFriendInviteInputVisible(false);
        setFriendInviteInput("");
        setIsFriendsLobbyState(false);
        pendingInviteShareModeRef.current = "link";
        setScreen("game");
        setPendingInviteCode("");
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          if (
            url.searchParams.has("ref") ||
            url.searchParams.has("tgWebAppStartParam")
          ) {
            url.searchParams.delete("ref");
            url.searchParams.delete("tgWebAppStartParam");
            window.history.replaceState(
              {},
              "",
              `${url.pathname}${url.search}${url.hash}`,
            );
          }
        }
        const rawOpp = msg.opp && typeof msg.opp === "object" ? msg.opp : null;
        const incomingOpp = rawOpp
          ? {
              id: rawOpp.id,
              name: typeof rawOpp.name === "string" ? rawOpp.name.trim() : "",
              username:
                typeof rawOpp.username === "string"
                  ? rawOpp.username.trim()
                  : "",
              avatar:
                typeof rawOpp.avatar === "string" ? rawOpp.avatar.trim() : "",
            }
          : null;

        setGame((prev) => {
          const updatedOpp =
            incomingOpp && String(incomingOpp.id) === String(meRef.current.id)
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
            roundWinsX: Number(msg.roundWinsX ?? 0) || 0,
            roundWinsO: Number(msg.roundWinsO ?? 0) || 0,
            roundNumber: Number(msg.roundNumber ?? 1) || 1,
            matchTargetWins: Number(msg.matchTargetWins ?? 3) || 3,
          };
        });

        setWinLine(null);
        hideModal();
        const myMoveAllowed = msg.you && msg.turn && msg.you === msg.turn;
        setStatus({
          text: myMoveAllowed ? "Ваш ход" : "Ход оппонента",
          blink: false,
        });
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
        setScreen("modes");
        setNavMode("waiting");
        setStatus({ text: "Поиск соперника…", blink: true });
        return;
      }

      if (msg.t === "queue.waiting") {
        setScreen("modes");
        const position = Number(msg.position ?? 0);
        if (Number.isFinite(position) && position > 0) {
          setStatus({
            text: `Поиск соперника… Позиция: ${position}`,
            blink: true,
          });
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
          const inviteCode =
            typeof msg.code === "string" ? msg.code.trim() : "";
          if (inviteCode) {
            setLobbyInviteCode(inviteCode);
            navigator.clipboard
              ?.writeText(inviteCode)
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
        setLobbyInviteCode("");
        setIsFriendsLobbyState(false);
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
        setGame((prev) => ({
          ...prev,
          board: Array.isArray(msg.board) ? msg.board.slice() : prev.board,
          turn: msg.turn || prev.turn,
          roundWinsX: Number(msg.roundWinsX ?? prev.roundWinsX) || 0,
          roundWinsO: Number(msg.roundWinsO ?? prev.roundWinsO) || 0,
          roundNumber: Number(msg.roundNumber ?? prev.roundNumber) || 1,
          matchTargetWins:
            Number(msg.matchTargetWins ?? prev.matchTargetWins) || 3,
        }));

        setWinLine(null);
        const allowed =
          gameRef.current.you &&
          gameRef.current.you === msg.turn &&
          gameRef.current.gameId;
        setStatus({
          text: allowed ? "Ваш ход" : "Ход оппонента",
          blink: false,
        });
        if (allowed) audioManager.playMove();
        return;
      }

      if (msg.t === "game.round_end") {
        const winnerMark = typeof msg.by === "string" ? msg.by : null;
        const youWon = winnerMark && winnerMark === gameRef.current.you;
        const youLost = winnerMark && winnerMark !== gameRef.current.you;

        setGame((prev) => ({
          ...prev,
          roundWinsX: Number(msg.roundWinsX ?? prev.roundWinsX) || 0,
          roundWinsO: Number(msg.roundWinsO ?? prev.roundWinsO) || 0,
          roundNumber: Number(msg.roundNumber ?? prev.roundNumber) || 1,
          matchTargetWins:
            Number(msg.matchTargetWins ?? prev.matchTargetWins) || 3,
        }));

        if (Array.isArray(msg.line)) setWinLine(msg.line);

        if (msg.reason === "draw") {
          setStatus({ text: "Ничья в раунде. Новый раунд…", blink: false });
          audioManager.playDraw();
        } else if (youWon) {
          setStatus({ text: "Раунд за вами!", blink: false });
          audioManager.playWin();
        } else if (youLost) {
          setStatus({ text: "Раунд за соперником", blink: false });
          audioManager.playLose();
        }
        return;
      }

      if (msg.t === "game.match_end") {
        const winnerMark = typeof msg.by === "string" ? msg.by : null;
        const youWon = winnerMark && winnerMark === gameRef.current.you;
        const youLost = winnerMark && winnerMark !== gameRef.current.you;

        setNavMode("rematch");

        let title = "Матч завершён";
        let mainText = "Серия завершена.";
        let phrases = DRAW_PHRASES;
        let statusText = "Матч завершён";

        if (youWon) {
          title = "Победа в матче";
          mainText = "Вы выиграли серию!";
          phrases = WIN_PHRASES;
          statusText = "Победа в матче!";
          audioManager.playWin();
          statsSystemRef.current?.endGame("win");
        } else if (youLost) {
          title = "Поражение в матче";
          mainText = "Соперник выиграл серию.";
          phrases = LOSE_PHRASES;
          statusText = "Поражение в матче";
          audioManager.playLose();
          statsSystemRef.current?.endGame("lose");
        } else {
          statusText = "Матч завершён";
          audioManager.playDraw();
          statsSystemRef.current?.endGame("draw");
        }

        setModal({
          title,
          content: buildResultContent(mainText, phrases),
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

        if (
          msg.reason === "win" ||
          msg.reason === "draw" ||
          msg.reason === "match_end"
        ) {
          return;
        }

        setNavMode("rematch");

        let title = "Игра завершена";
        let mainText = "Игра завершена.";
        let phrases = null;
        let statusText = "Игра завершена";

        if (msg.reason === "resign") {
          if (youWon) {
            title = "Победа";
            mainText = "Оппонент сдался.";
            phrases = WIN_PHRASES;
            statusText = "Победа!";
            audioManager.playWin();
            statsSystemRef.current?.endGame("win");
          } else if (youLost) {
            title = "Поражение";
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
            title = "Победа";
            mainText = "Оппонент отключился.";
            phrases = WIN_PHRASES;
            statusText = "Победа!";
            audioManager.playWin();
            statsSystemRef.current?.endGame("win");
          } else if (youLost) {
            title = "Поражение";
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
            title = "Победа";
            mainText = "Вы победили!";
            phrases = WIN_PHRASES;
            statusText = "Победа!";
            statsSystemRef.current?.endGame("win");
          } else if (youLost) {
            title = "Поражение";
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
    ],
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
        if (!gameRef.current.opp || normalizeId(gameRef.current.opp.id) !== id)
          return;

        const avatar =
          typeof profile.avatar_url === "string"
            ? profile.avatar_url.trim()
            : "";
        const usernameRaw =
          typeof profile.username === "string" ? profile.username.trim() : "";
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
            lastOpp: prev.lastOpp
              ? { ...prev.lastOpp, ...updatedOpp }
              : updatedOpp,
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
      document.body.style.animationPlayState = document.hidden
        ? "paused"
        : "running";
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
      image: "/img/search.svg",
      imageClassName: navMode === "waiting" ? "mode-card__image--searching" : "",
      mediaClassName: navMode === "waiting" ? "mode-card__media--searching" : "",
      title: "Играть онлайн",
      description: "Быстрый матч через общую очередь игроков.",
      onSelect: handlePlayOnline,
      renderExtra: () => null,
    },
    {
      id: "friends",
      image: "/img/frends.svg",
      title: "Играть с друзьями",
      description: "Создайте лобби или подключитесь по коду приглашения.",
      onSelect: null,
      renderExtra: () => (
        <div
          className="mode-card__friend-actions"
          onClick={(event) => event.stopPropagation()}
        >
          {friendInviteInputVisible ? (
            <div className="mode-card__friend-join mode-card__friend-join--expanded">
              <input
                className="mode-card__friend-input"
                value={friendInviteInput}
                onChange={(event) => setFriendInviteInput(event.target.value)}
                placeholder="Введите инвайт-код"
                autoFocus
              />
              <button
                type="button"
                className="mode-card__friend-button mode-card__friend-button--alt"
                onClick={joinFriendsLobby}
              >
                Войти
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="mode-card__friend-button"
                onClick={createFriendsLobby}
              >
                Создать
              </button>
              <button
                type="button"
                className="mode-card__friend-button mode-card__friend-button--alt"
                onClick={() => setFriendInviteInputVisible(true)}
              >
                Присоединиться
              </button>
            </>
          )}
        </div>
      ),
    },
    {
      id: "computer",
      image: "/img/logo.svg",
      title: "Играть с компьютером",
      description: "Сыграйте матч против компьютера.",
      onSelect: startComputerGame,
    },
  ];

  const activeModeId = modeCards[activeModeIndex]?.id || "";
  const showInviteCode = activeModeId === "friends" || isFriendsLobbyState;

  const shouldShowBoard = Boolean(game.gameId || screen === "game");
  const isLobbyScreen = !shouldShowBoard;
  const viewTransitionClass = `wrap--view-${shouldShowBoard ? "game" : "modes"}${isViewEntering ? " wrap--view-enter" : ""}`;

  return (
    <div id="app">
      {shouldShowBoard ? (
        <Board
          me={me}
          game={gameView}
          onlineStats={onlineStats}
          coinBalance={coinBalance}
          statusText={status}
          winLine={winLine}
          onCellClick={handleCellClick}
          onAuthorClick={handleAuthorClick}
          viewTransitionClass={viewTransitionClass}
          lobbyInviteCode={showInviteCode ? lobbyInviteCode : ""}
          onInviteCodeClick={() => {
            if (!lobbyInviteCode) return;
            navigator.clipboard
              ?.writeText(lobbyInviteCode)
              .then(() => notifications.success("Код лобби скопирован"))
              .catch(() => notifications.info(`Код лобби: ${lobbyInviteCode}`));
          }}
        />
      ) : (
        <Board
          me={me}
          game={gameView}
          onlineStats={onlineStats}
          coinBalance={coinBalance}
          statusText={status}
          onCellClick={handleCellClick}
          onAuthorClick={handleAuthorClick}
          viewTransitionClass={viewTransitionClass}
          lobbyInviteCode={showInviteCode ? lobbyInviteCode : ""}
          onInviteCodeClick={() => {
            if (!lobbyInviteCode) return;
            navigator.clipboard
              ?.writeText(lobbyInviteCode)
              .then(() => notifications.success("Код лобби скопирован"))
              .catch(() => notifications.info(`Код лобби: ${lobbyInviteCode}`));
          }}
          modesLayout
          boardContent={
            <GameModesCarousel
              items={modeCards}
              activeIndex={activeModeIndex}
              onChange={setActiveModeIndex}
            />
          }
        />
      )}
      <Nav
        mode={navMode}
        onAction={onNavAction}
        onRating={loadRating}
        onProfile={loadProfile}
        isGameScreen={!isLobbyScreen}
      />
      <Modal
        open={modalState.open}
        title={modalState.title}
        content={modalState.content}
        primary={modalState.primary}
        secondary={modalState.secondary}
      />
      <Notifications
        items={notifications.notifications}
        onClose={notifications.remove}
      />
    </div>
  );
}
