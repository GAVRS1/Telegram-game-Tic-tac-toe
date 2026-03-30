const REFERRAL_PREFIX = "ref_";
const LOBBY_INVITE_PREFIX = "lobby_";

function normalizePayload(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function parseStartPayload(value) {
  const payload = normalizePayload(value);
  if (!payload) return { kind: "none", raw: "" };

  const lower = payload.toLowerCase();
  if (lower.startsWith(REFERRAL_PREFIX)) {
    const refCode = payload.slice(REFERRAL_PREFIX.length).trim();
    if (!refCode) return { kind: "invalid", raw: payload, reason: "empty_ref_code" };
    return { kind: "referral", raw: payload, refCode: refCode.toUpperCase() };
  }

  if (lower.startsWith(LOBBY_INVITE_PREFIX)) {
    const inviteCode = payload.slice(LOBBY_INVITE_PREFIX.length).trim();
    if (!inviteCode) return { kind: "invalid", raw: payload, reason: "empty_lobby_code" };
    return { kind: "lobby_invite", raw: payload, inviteCode: inviteCode.toUpperCase() };
  }

  return { kind: "unknown", raw: payload };
}

export function buildReferralPayload(refCode) {
  const normalized = normalizePayload(refCode).toUpperCase();
  if (!normalized) return "";
  return `${REFERRAL_PREFIX}${normalized}`;
}

export function buildLobbyInvitePayload(inviteCode) {
  const normalized = normalizePayload(inviteCode).toUpperCase();
  if (!normalized) return "";
  return `${LOBBY_INVITE_PREFIX}${normalized}`;
}
