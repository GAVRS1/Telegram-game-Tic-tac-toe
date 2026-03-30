import crypto from "node:crypto";
import {
  createInvite,
  getPendingInviteByHost,
} from "../db.js";
import { buildLobbyInvitePayload } from "../common/startPayload.js";

const INVITE_TTL_MS = 1000 * 60 * 30;
const INVITE_CODE_LENGTH = 10;

export const createInviteService = ({ port, publicUrl }) => {
  const inviteByCode = new Map();
  const inviteCodeByHost = new Map();

  const generateInviteCode = () =>
    crypto.randomBytes(8).toString("base64url").slice(0, INVITE_CODE_LENGTH);

  const buildInviteLink = (req, code) => {
    const payload = encodeURIComponent(buildLobbyInvitePayload(code));
    return `https://t.me/TTToeONL_bot/game?startapp=${payload}`;
  };

  const cacheInvite = (invite) => {
    if (!invite?.code || !invite?.host_user_id) return;
    const normalized = {
      ...invite,
      code: String(invite.code),
      host_user_id: String(invite.host_user_id),
    };
    inviteByCode.set(normalized.code, normalized);
    inviteCodeByHost.set(normalized.host_user_id, normalized.code);
  };

  const dropInviteCache = (code, hostUserId = null) => {
    if (code) {
      const existing = inviteByCode.get(code);
      if (existing?.host_user_id) inviteCodeByHost.delete(existing.host_user_id);
      inviteByCode.delete(code);
    }
    if (hostUserId) inviteCodeByHost.delete(String(hostUserId));
  };

  const isInviteExpired = (invite) => {
    const expiresAt = new Date(invite?.expires_at || 0).getTime();
    return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  };

  const getValidInviteByHost = async (hostUserId) => {
    const host = String(hostUserId || "");
    if (!host) return null;

    const cachedCode = inviteCodeByHost.get(host);
    if (cachedCode) {
      const cachedInvite = inviteByCode.get(cachedCode);
      if (cachedInvite && cachedInvite.status === "pending" && !isInviteExpired(cachedInvite)) {
        return cachedInvite;
      }
      dropInviteCache(cachedCode, host);
    }

    const dbInvite = await getPendingInviteByHost(host);
    if (dbInvite) {
      cacheInvite(dbInvite);
      return dbInvite;
    }
    return null;
  };

  const createInviteRecord = async (hostUserId) => {
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    for (let i = 0; i < 5; i += 1) {
      const code = generateInviteCode();
      const invite = await createInvite({ code, hostUserId, expiresAt });
      if (invite) return invite;
    }
    return null;
  };

  const getCachedInviteByCode = (code) => inviteByCode.get(code);

  return {
    buildInviteLink,
    cacheInvite,
    dropInviteCache,
    getValidInviteByHost,
    createInviteRecord,
    getCachedInviteByCode,
  };
};
