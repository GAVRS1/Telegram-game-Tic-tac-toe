export function normalizeId(id) {
  if (id == null) return "";
  return String(id).trim();
}

export function isNumericId(id) {
  return typeof id === "string" ? /^[0-9]+$/.test(id) : Number.isFinite(id);
}

export function sanitizeUsername(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32);
}
