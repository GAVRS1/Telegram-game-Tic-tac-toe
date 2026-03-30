import { bindReferral, ensureSchema, upsertUser } from "../../db.js";
import { extractUserData, validateTelegramInitData } from "../../telegramAuth.js";
import { sanitizeString, validateHelloMessage } from "../../validation.js";
import { buildTelegramName, sanitizeUsername } from "../../common/sanitize.js";

function resolveReferralCode(startParam) {
  if (typeof startParam !== "string") return null;
  const trimmed = startParam.trim().toUpperCase();
  if (!trimmed) return null;

  const prefixed = trimmed.match(/^REF[_:-]?([A-Z0-9]+)$/);
  if (prefixed) return prefixed[1];
  return null;
}

export const createHelloHandler = ({ wsByUid, userByWs, broadcastOnlineStats }) => async (ws, msg) => {
  if (!validateHelloMessage(msg)) return;

  const uid = String(msg.uid);
  const name = sanitizeString(msg.name || "Player");
  const avatar = (msg.avatar || "").slice(0, 500);
  const initData = typeof msg.initData === "string" ? msg.initData : "";
  const usernameHint = sanitizeUsername(msg.username);

  let profile = { id: uid, name, username: usernameHint, avatar, isVerified: false, source: "fallback" };

  let inviterRefCode = resolveReferralCode(typeof msg.startParam === "string" ? msg.startParam : "");

  if (initData) {
    const initDataValidation = validateTelegramInitData(initData);
    if (initDataValidation.reason === "expired") {
      const authDateIso = new Date(initDataValidation.authDate * 1000).toISOString();
      console.warn(
        `[HELLO] expired initData uid=${uid} auth_date=${authDateIso} age_sec=${initDataValidation.ageSec} ttl_sec=${initDataValidation.ttlSec}`
      );
    }

    if (initDataValidation.isValid) {
      const userData = extractUserData(initData, { skipValidation: true });
      if (userData && String(userData.id) === uid) {
        profile = {
          id: uid,
          name: buildTelegramName(userData),
          username: (userData.username || "").trim(),
          avatar: userData.photo_url || "",
          isVerified: true,
          source: "telegram",
        };
      }

      if (!inviterRefCode) {
        const params = new URLSearchParams(initData);
        inviterRefCode = resolveReferralCode(params.get("start_param"));
      }
    }
  }

  const prev = wsByUid.get(uid);
  if (prev && prev !== ws) {
    try {
      prev.close();
    } catch {}
  }

  wsByUid.set(uid, ws);
  userByWs.set(ws, {
    id: profile.id,
    name: profile.name,
    username: profile.username,
    avatar: profile.avatar,
    lastOpponent: null,
    isVerified: profile.isVerified,
  });

  console.log(`[HELLO] uid=${uid} name="${profile.name}" verified=${profile.isVerified} src=${profile.source}`);
  broadcastOnlineStats();

  try {
    await ensureSchema();
    if (/^[0-9]+$/.test(uid)) {
      const usernameForDb = profile.username || profile.name;
      await upsertUser({ id: uid, username: usernameForDb, avatar_url: profile.avatar });
      if (inviterRefCode) {
        await bindReferral({ inviterRefCode, invitedId: uid });
      }
    }
  } catch {}
};
