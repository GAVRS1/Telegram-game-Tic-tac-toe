import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sanitizeUsername } from "../utils/identity.js";

const APP_NAME = "TicTacToeTWA";

function initTelegram(tg) {
  if (!tg) return;
  try {
    tg.expand();
    tg.ready();
    tg.enableClosingConfirmation();
    tg.setHeaderColor(tg.colorScheme === "dark" ? "#0f172a" : "#ffffff");
    tg.setBackgroundColor(tg.colorScheme === "dark" ? "#0b1220" : "#f8fafc");
  } catch {}
}

function getTelegramUser(tg) {
  return tg?.initDataUnsafe?.user || null;
}

function readInitDataFromLocation() {
  if (typeof window === "undefined") return "";

  const candidates = [];
  try {
    const url = new URL(window.location.href);
    candidates.push(url.searchParams.get("tgWebAppData") || "");
  } catch {}

  try {
    const hash = String(window.location.hash || "");
    if (hash.startsWith("#")) {
      const hashParams = new URLSearchParams(hash.slice(1));
      candidates.push(hashParams.get("tgWebAppData") || "");
    }
  } catch {}

  for (const raw of candidates) {
    const value = String(raw || "").trim();
    if (!value) continue;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return "";
}

function parseUserFromInitData(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const userRaw = params.get("user");
    if (!userRaw) return null;
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

function getTelegramWebApp() {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp || null;
}

function fullName(user) {
  if (!user) return "Player";
  const first = (user.first_name || user.firstName || "").trim();
  const last = (user.last_name || user.lastName || "").trim();
  const username = (user.username || user.user_name || "").trim();
  const name = (first || last)
    ? `${first}${last ? " " + last : ""}`.trim()
    : username || "Player";
  return name || "Player";
}

function getOrCreateSessionId() {
  const key = `${APP_NAME}:uid:session`;
  let value = null;
  try {
    value = sessionStorage.getItem(key);
  } catch {}
  if (!value) {
    value = `u_${Math.random().toString(36).slice(2)}`;
    try {
      sessionStorage.setItem(key, value);
    } catch {}
  }
  return String(value);
}

function buildInitialMe(user) {
  const id = user?.id ? String(user.id) : getOrCreateSessionId();
  const name = fullName(user) || localStorage.getItem(`${APP_NAME}:name`) || "Player";
  const avatar = user?.photo_url || localStorage.getItem(`${APP_NAME}:avatar`) || "";
  const username = sanitizeUsername(user?.username || user?.user_name || "");
  return { id, name, avatar, username };
}

export function useTelegramAuth() {
  const [telegram, setTelegram] = useState(null);
  const [initData, setInitData] = useState(() => {
    const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : null;
    return tg?.initData || readInitDataFromLocation() || "";
  });
  const [me, setMe] = useState(() => {
    const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : null;
    const user = getTelegramUser(tg) || parseUserFromInitData(tg?.initData || readInitDataFromLocation());
    return buildInitialMe(user);
  });

  const meRef = useRef(me);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    let attempts = 0;
    let timer = null;

    const attachTelegram = () => {
      const tg = getTelegramWebApp();
      if (!tg) return false;

      initTelegram(tg);
      setTelegram(tg);
      setInitData(tg.initData || readInitDataFromLocation() || "");

      const user = getTelegramUser(tg) || parseUserFromInitData(tg.initData || readInitDataFromLocation());
      if (user) {
        setMe((prev) => {
          const next = buildInitialMe(user);
          if (
            prev.id === next.id
            && prev.name === next.name
            && prev.avatar === next.avatar
            && prev.username === next.username
          ) {
            return prev;
          }
          return next;
        });
      }

      return true;
    };

    if (attachTelegram()) return;

    timer = window.setInterval(() => {
      attempts += 1;
      if (attachTelegram() || attempts >= 30) {
        window.clearInterval(timer);
      }
    }, 200);

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(`${APP_NAME}:name`, me.name);
      if (me.avatar) localStorage.setItem(`${APP_NAME}:avatar`, me.avatar);
    } catch {}
  }, [me]);

  const refreshIdentity = useCallback(() => {
    const tg = telegram || (typeof window !== "undefined" ? window.Telegram?.WebApp : null);
    const nextInitData =
      (typeof tg?.initData === "string" ? tg.initData : "")
      || readInitDataFromLocation();
    if (nextInitData && nextInitData !== initData) {
      setInitData(nextInitData);
    }

    const user = getTelegramUser(tg) || parseUserFromInitData(nextInitData);
    if (!user) return false;

    const nextId = user?.id ? String(user.id) : null;
    const nextName = fullName(user);
    const nextAvatar = user?.photo_url || meRef.current.avatar || "";
    const nextUsername = sanitizeUsername(user?.username || user?.user_name || "");

    let changed = false;
    setMe((prev) => {
      const updated = { ...prev };
      if (nextId && nextId !== prev.id) {
        updated.id = nextId;
        changed = true;
        try {
          sessionStorage.setItem(`${APP_NAME}:uid:session`, updated.id);
        } catch {}
      }
      if (nextName && nextName !== prev.name) {
        updated.name = nextName;
        changed = true;
      }
      if (nextAvatar && nextAvatar !== prev.avatar) {
        updated.avatar = nextAvatar;
        changed = true;
      }
      if (nextUsername !== undefined && nextUsername !== prev.username) {
        updated.username = nextUsername;
        changed = true;
      }
      if (!changed) return prev;
      return updated;
    });

    return changed;
  }, [initData, telegram]);

  const value = useMemo(
    () => ({ telegram, initData, me, setMe, refreshIdentity, meRef }),
    [telegram, initData, me, refreshIdentity]
  );

  return value;
}
