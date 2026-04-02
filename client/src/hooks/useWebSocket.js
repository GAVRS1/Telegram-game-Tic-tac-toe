import { useEffect, useRef } from "react";

export function useWebSocket({ url, urls = [], onOpen, onMessage, onClose }) {
  const socketRef = useRef(null);
  const retriesRef = useRef(0);
  const connectingRef = useRef(false);
  const urlIndexRef = useRef(0);
  const openedAtRef = useRef(0);
  const onOpenRef = useRef(onOpen);
  const onMessageRef = useRef(onMessage);
  const onCloseRef = useRef(onClose);

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
    const urlCandidates = [...new Set([...(Array.isArray(urls) ? urls : []), url].filter(Boolean))];
    if (!urlCandidates.length) return undefined;

    let active = true;

    const connect = () => {
      if (!active || connectingRef.current) return;
      connectingRef.current = true;
      const wsUrl = urlCandidates[urlIndexRef.current % urlCandidates.length];
      if (!wsUrl) {
        connectingRef.current = false;
        return;
      }

      try {
        const socket = new WebSocket(wsUrl);
        socketRef.current = socket;

        socket.addEventListener("open", () => {
          connectingRef.current = false;
          retriesRef.current = 0;
          openedAtRef.current = Date.now();
          onOpenRef.current?.();
        });

        socket.addEventListener("message", (event) => {
          let msg = null;
          try {
            msg = JSON.parse(event.data);
          } catch {
            return;
          }
          onMessageRef.current?.(msg);
        });

        socket.addEventListener("close", () => {
          const hadSuccessfulOpen = openedAtRef.current > 0;
          if (hadSuccessfulOpen) onCloseRef.current?.();
          connectingRef.current = false;
          const livedMs = openedAtRef.current ? Date.now() - openedAtRef.current : 0;
          openedAtRef.current = 0;
          if (livedMs < 15_000 && urlCandidates.length > 1) {
            urlIndexRef.current = (urlIndexRef.current + 1) % urlCandidates.length;
          }
          const delay = Math.min(1000 * 2 ** retriesRef.current++, 15000);
          setTimeout(connect, delay);
        });

        socket.addEventListener("error", () => {});
      } catch {
        connectingRef.current = false;
        const delay = Math.min(1000 * 2 ** retriesRef.current++, 15000);
        setTimeout(connect, delay);
      }
    };

    connect();

    return () => {
      active = false;
      try {
        socketRef.current?.close();
      } catch {}
    };
  }, [url, urls]);

  const send = (payload) => {
    try {
      if (socketRef.current?.readyState === 1) {
        socketRef.current.send(JSON.stringify(payload));
      }
    } catch {}
  };

  return { send };
}
