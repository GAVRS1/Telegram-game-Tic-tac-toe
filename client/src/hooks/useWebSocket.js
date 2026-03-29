import { useEffect, useRef } from "react";

export function useWebSocket({ url, onOpen, onMessage, onClose }) {
  const socketRef = useRef(null);
  const retriesRef = useRef(0);
  const connectingRef = useRef(false);
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
    if (!url) return undefined;

    let active = true;

    const connect = () => {
      if (!active || connectingRef.current) return;
      connectingRef.current = true;

      try {
        const socket = new WebSocket(url);
        socketRef.current = socket;

        socket.addEventListener("open", () => {
          connectingRef.current = false;
          retriesRef.current = 0;
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
          onCloseRef.current?.();
          connectingRef.current = false;
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
  }, [url]);

  const send = (payload) => {
    try {
      if (socketRef.current?.readyState === 1) {
        socketRef.current.send(JSON.stringify(payload));
      }
    } catch {}
  };

  return { send };
}
