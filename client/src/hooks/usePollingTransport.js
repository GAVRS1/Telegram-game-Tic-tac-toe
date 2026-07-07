import { useEffect, useRef } from "react";
import { apiUrl } from "../utils/network.js";

const RECONNECT_MAX_MS = 15000;
const FAIL_LIMIT = 3;
const HIDDEN_POLL_MS = 10000;

// Транспорт с интерфейсом useWebSocket, но поверх HTTP-поллинга.
// Используется, когда бэкенд работает на Netlify Functions и постоянного
// WebSocket-соединения нет: сообщения уходят POST'ом, входящие забираются poll'ом.
export function usePollingTransport({ enabled, onOpen, onMessage, onClose }) {
  const sidRef = useRef("");
  const intervalRef = useRef(3500);
  const failsRef = useRef(0);
  const retriesRef = useRef(0);
  const activeRef = useRef(false);
  const pollTimerRef = useRef(null);
  const wasOpenRef = useRef(false);
  const pendingSendsRef = useRef([]);
  const onOpenRef = useRef(onOpen);
  const onMessageRef = useRef(onMessage);
  const onCloseRef = useRef(onClose);
  const sendRef = useRef(() => {});

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled) return undefined;
    activeRef.current = true;

    const dispatch = (messages) => {
      if (!Array.isArray(messages)) return;
      for (const msg of messages) {
        if (msg && typeof msg === "object") onMessageRef.current?.(msg);
      }
    };

    const post = async (path, body) => {
      const response = await fetch(apiUrl(path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      if (response.status === 410) {
        const error = new Error("session gone");
        error.gone = true;
        throw error;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };

    const markClosed = () => {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        onCloseRef.current?.();
      }
    };

    const scheduleReconnect = () => {
      if (!activeRef.current) return;
      const delay = Math.min(1000 * 2 ** retriesRef.current++, RECONNECT_MAX_MS);
      setTimeout(connect, delay);
    };

    const schedulePoll = (delay) => {
      if (!activeRef.current) return;
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(poll, delay);
    };

    const poll = async () => {
      if (!activeRef.current || !sidRef.current) return;
      const hidden = typeof document !== "undefined" && document.hidden;
      try {
        const data = await post("/rt/poll", { sid: sidRef.current });
        failsRef.current = 0;
        if (Number.isFinite(data.interval) && data.interval > 300) {
          intervalRef.current = data.interval;
        }
        dispatch(data.messages);
        schedulePoll(hidden ? Math.max(intervalRef.current, HIDDEN_POLL_MS) : intervalRef.current);
      } catch (error) {
        if (!activeRef.current) return;
        if (error.gone) {
          sidRef.current = "";
          markClosed();
          scheduleReconnect();
          return;
        }
        failsRef.current += 1;
        if (failsRef.current >= FAIL_LIMIT) {
          sidRef.current = "";
          markClosed();
          scheduleReconnect();
          return;
        }
        schedulePoll(intervalRef.current * 2);
      }
    };

    const flushPending = () => {
      const pending = pendingSendsRef.current.splice(0);
      for (const payload of pending) sendNow(payload);
    };

    const connect = async () => {
      if (!activeRef.current || sidRef.current) return;
      try {
        const data = await post("/rt/connect", {});
        if (!activeRef.current || !data?.sid) throw new Error("no sid");
        sidRef.current = data.sid;
        failsRef.current = 0;
        retriesRef.current = 0;
        if (Number.isFinite(data.interval) && data.interval > 300) {
          intervalRef.current = data.interval;
        }
        wasOpenRef.current = true;
        onOpenRef.current?.();
        dispatch(data.messages);
        flushPending();
        schedulePoll(intervalRef.current);
      } catch {
        if (!activeRef.current) return;
        scheduleReconnect();
      }
    };

    const sendNow = (payload) => {
      if (!sidRef.current) {
        pendingSendsRef.current.push(payload);
        return;
      }
      post("/rt/send", { sid: sidRef.current, msg: payload })
        .then((data) => {
          if (!activeRef.current) return;
          if (Number.isFinite(data.interval) && data.interval > 300) {
            intervalRef.current = data.interval;
          }
          dispatch(data.messages);
          // после действия (например queue.join) сразу перезапускаем цикл поллинга
          schedulePoll(intervalRef.current);
        })
        .catch((error) => {
          if (!activeRef.current) return;
          if (error.gone) {
            sidRef.current = "";
            markClosed();
            scheduleReconnect();
          }
        });
    };

    sendRef.current = sendNow;

    const handleVisibility = () => {
      if (typeof document === "undefined") return;
      if (!document.hidden && sidRef.current) schedulePoll(150);
    };
    document.addEventListener("visibilitychange", handleVisibility);

    connect();

    return () => {
      activeRef.current = false;
      clearTimeout(pollTimerRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      sidRef.current = "";
      wasOpenRef.current = false;
      sendRef.current = () => {};
    };
  }, [enabled]);

  const send = (payload) => {
    try {
      sendRef.current(payload);
    } catch {}
  };

  return { send };
}
