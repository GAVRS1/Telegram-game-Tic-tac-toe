import { useCallback, useRef, useState } from "react";

export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const idRef = useRef(0);

  const remove = useCallback((id) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const show = useCallback((message, type = "info", duration = 3000) => {
    const id = ++idRef.current;
    const item = { id, message, type };
    setNotifications((prev) => [...prev, item]);

    if (duration > 0) {
      setTimeout(() => remove(id), duration);
    }

    return id;
  }, [remove]);

  const api = {
    show,
    success: (message, duration) => show(message, "success", duration),
    error: (message, duration) => show(message, "error", duration),
    warning: (message, duration) => show(message, "warning", duration),
    info: (message, duration) => show(message, "info", duration),
  };

  return { notifications, remove, ...api };
}
