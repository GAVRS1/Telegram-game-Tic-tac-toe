import { sanitizeString } from "../validation.js";

export const sanitizeUsername = (value) => {
  if (!value || typeof value !== "string") return "";
  return value.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32);
};

export const buildTelegramName = (user) => {
  if (!user) return "Player";
  const first = (user.first_name || "").trim();
  const last = (user.last_name || "").trim();
  const username = (user.username || "").trim();
  const combined = `${first} ${last}`.trim();
  return sanitizeString(combined || username || "Player");
};
