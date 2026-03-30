import { bindReferral, ensureSchema, upsertUser } from "../../db.js";
import { extractUserData, validateTelegramInitData } from "../../telegramAuth.js";
import { sanitizeString, validateHelloMessage } from "../../validation.js";
import { buildTelegramName, sanitizeUsername } from "../../common/sanitize.js";
import { parseStartPayload } from "../../common/startPayload.js";

export const createHelloHandler = ({ wsByUid, userByWs, broadcastOnlineStats }) => async (ws, msg) => {
  if (!validateHelloMessage(msg)) return;

  const uid = String(msg.uid);
  const name = sanitizeString(msg.name || "Player");
  const avatar = (msg.avatar || "").slice(0, 500);
  const initData = typeof msg.initData === "string" ? msg.initData : "";
  const usernameHint = sanitizeUsername(msg.username);

  let profile = { id: uid, name, username: usernameHint, avatar, isVerified: false, source: "fallback" };

  const startPayloadCandidates = [];
  if (typeof msg.startParam === "string") {
    startPayloadCandidates.push(msg.startParam);
  }
  let parsedStartPayload = { kind: "none", raw: "" };
  let inviterRefCode = null;

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

      if (parsedStartPayload.kind === "none") {
        const params = new URLSearchParams(initData);
        startPayloadCandidates.push(params.get("start_param") || "");
      }
    }
  }

  for (const candidate of startPayloadCandidates) {
    const parsed = parseStartPayload(candidate);
    if (parsed.kind === "none") continue;
    parsedStartPayload = parsed;
    if (parsed.kind === "referral" && !inviterRefCode) {
      inviterRefCode = parsed.refCode;
    }
    if (parsed.kind === "referral" || parsed.kind === "lobby_invite") {
      break;
    }
  }

  if (parsedStartPayload.kind === "invalid") {
    console.warn(`[HELLO] uid=${uid} rejected start payload: ${parsedStartPayload.reason}`);
  }

  const registrationSource = profile.isVerified ? "telegram_init_data" : null;
  const registrationPayload = profile.isVerified && parsedStartPayload.kind !== "none" ? parsedStartPayload.raw : null;

  if (!profile.isVerified && parsedStartPayload.kind === "referral") {
    // Referrals are only attributed for verified Telegram sessions.
    inviterRefCode = null;
  }

  if (parsedStartPayload.kind === "unknown") {
    console.log(`[HELLO] uid=${uid} unknown start payload="${parsedStartPayload.raw}"`);
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
      await upsertUser({
        id: uid,
        username: usernameForDb,
        avatar_url: profile.avatar,
        registrationSource,
        registrationPayload,
      });
      if (inviterRefCode) {
        const referralResult = await bindReferral({ inviterRefCode, invitedId: uid });
        if (referralResult.linked) {
          console.log(`[REFERRAL] uid=${uid} linked via ref=${inviterRefCode}`);
        } else {
          console.log(
            `[REFERRAL] uid=${uid} skipped ref=${inviterRefCode} reason=${referralResult.reason || "unknown"}`
          );
        }
      }
    }
  } catch {}
};
