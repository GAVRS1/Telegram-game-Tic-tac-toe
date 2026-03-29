export const isNumericId = (id) =>
  typeof id === "string" ? /^[0-9]+$/.test(id) : Number.isFinite(id);

export const toUid = (value) => String(value || "").trim();
