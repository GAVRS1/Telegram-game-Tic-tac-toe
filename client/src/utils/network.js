const ENV_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
const ENV_WS_URL_RAW = (import.meta.env.VITE_WS_URL || "").trim();

function isUnstableTunnelUrl(url) {
  return /https?:\/\/[^/]*trycloudflare\.com/i.test(url) || /wss?:\/\/[^/]*trycloudflare\.com/i.test(url);
}

function resolveApiBaseUrl() {
  if (ENV_API_BASE_URL && !isUnstableTunnelUrl(ENV_API_BASE_URL)) {
    return ENV_API_BASE_URL;
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

function normalizeWsProtocol(url) {
  if (!url) return "";
  if (/^wss?:\/\//i.test(url)) return url;
  if (/^wss?:/i.test(url)) {
    return url.replace(/^wss?:/i, (match) => `${match}//`);
  }
  return url;
}

function httpToWs(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) {
    return url.replace(/^http/i, "ws");
  }
  return "";
}

export function resolveWsCandidates() {
  const candidates = [];
  const normalizedEnv = normalizeWsProtocol(ENV_WS_URL_RAW);
  if (normalizedEnv && !isUnstableTunnelUrl(normalizedEnv)) candidates.push(normalizedEnv);

  const fromApiBase = httpToWs(resolveApiBaseUrl());
  if (fromApiBase) candidates.push(fromApiBase);

  if (typeof window !== "undefined") {
    candidates.push(window.location.origin.replace(/^http/i, "ws"));
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function resolveWsUrl() {
  return resolveWsCandidates()[0] || "";
}

export function apiUrl(path) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const apiBase = resolveApiBaseUrl();
  if (!apiBase) return cleanPath;
  return `${apiBase}${cleanPath}`;
}
