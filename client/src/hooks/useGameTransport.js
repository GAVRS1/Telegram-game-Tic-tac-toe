import { useWebSocket } from "./useWebSocket.js";
import { usePollingTransport } from "./usePollingTransport.js";
import { resolveWsCandidates } from "../utils/network.js";

// Выбор транспорта:
//  - VITE_TRANSPORT=ws|polling — явное переключение;
//  - иначе WS, если задан VITE_WS_URL (классический Node-бэкенд),
//    и HTTP-поллинг, если нет (бэкенд на Netlify Functions).
const explicitMode = (import.meta.env.VITE_TRANSPORT || "").trim().toLowerCase();
const hasWsUrl = Boolean((import.meta.env.VITE_WS_URL || "").trim());
const MODE = explicitMode === "ws" || explicitMode === "polling"
  ? explicitMode
  : hasWsUrl
    ? "ws"
    : "polling";

export function useGameTransport({ onOpen, onMessage, onClose }) {
  const wsUrls = MODE === "ws" ? resolveWsCandidates() : [];
  const { send: sendWs } = useWebSocket({
    url: wsUrls[0] || "",
    urls: wsUrls,
    onOpen,
    onMessage,
    onClose,
  });
  const { send: sendPoll } = usePollingTransport({
    enabled: MODE === "polling",
    onOpen,
    onMessage,
    onClose,
  });

  return { send: MODE === "ws" ? sendWs : sendPoll, mode: MODE };
}
