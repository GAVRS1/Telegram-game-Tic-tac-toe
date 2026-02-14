const ENV_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
const ENV_WS_URL_RAW = (import.meta.env.VITE_WS_URL || "").trim();

function normalizeWsProtocol(url) {
  if (!url) return "";
  if (/^wss?:\/\//i.test(url)) return url;
  if (/^wss?:/i.test(url)) {
    return url.replace(/^wss?:/i, (match) => `${match}//`);
  }
  return url;
}

export function resolveWsUrl() {
  const normalizedEnv = normalizeWsProtocol(ENV_WS_URL_RAW);
  if (normalizedEnv) return normalizedEnv;
  if (typeof window === "undefined") return "";
  return window.location.origin.replace(/^http/i, "ws");
}

export function apiUrl(path) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (!ENV_API_BASE_URL) return cleanPath;
  return `${ENV_API_BASE_URL}${cleanPath}`;
}
