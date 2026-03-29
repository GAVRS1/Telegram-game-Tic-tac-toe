import { acceptInvite, ensureSchema, expireInvite, getInvite } from "../../db.js";
import { send } from "../../common/ws.js";

export const createInviteHandlers = ({ userByWs, wsByUid, inviteService, matchmaking }) => ({
  async invite_create(ws) {
    const uid = userByWs.get(ws)?.id;
    if (!uid) return;

    try {
      await ensureSchema();
      const reusable = await inviteService.getValidInviteByHost(uid);
      const invite = reusable || (await inviteService.createInviteRecord(uid));
      if (!invite) {
        send(ws, { t: "invite.invalid", reason: "create_failed" });
        return;
      }
      inviteService.cacheInvite(invite);
      const link = inviteService.buildInviteLink(null, invite.code);
      send(ws, { t: "invite.created", code: invite.code, link, expiresAt: invite.expires_at });
      send(ws, { t: "invite.waiting", code: invite.code });
    } catch (error) {
      console.error("invite_create error:", error);
      send(ws, { t: "invite.invalid", reason: "create_failed" });
    }
  },

  async invite_accept(ws, msg) {
    const code = typeof msg.code === "string" ? msg.code.trim() : "";
    const guestId = userByWs.get(ws)?.id;
    if (!code || !guestId) return;

    try {
      await ensureSchema();
      const cachedInvite = inviteService.getCachedInviteByCode(code);
      const invite = cachedInvite || (await getInvite(code));
      if (!invite) {
        send(ws, { t: "invite.invalid", reason: "not_found" });
        return;
      }
      if (!cachedInvite) inviteService.cacheInvite(invite);
      if (invite.status !== "pending") {
        inviteService.dropInviteCache(code, invite.host_user_id);
        send(ws, { t: "invite.invalid", reason: "used" });
        return;
      }
      if (new Date(invite.expires_at).getTime() <= Date.now()) {
        await expireInvite(code);
        inviteService.dropInviteCache(code, invite.host_user_id);
        send(ws, { t: "invite.invalid", reason: "expired" });
        return;
      }
      if (String(invite.host_user_id) === String(guestId)) {
        send(ws, { t: "invite.invalid", reason: "self" });
        return;
      }

      const hostWs = wsByUid.get(String(invite.host_user_id));
      if (!hostWs) {
        send(ws, { t: "invite.invalid", reason: "host_offline" });
        return;
      }

      const accepted = await acceptInvite({ code, guestUserId: guestId });
      if (!accepted) {
        inviteService.dropInviteCache(code, invite.host_user_id);
        send(ws, { t: "invite.invalid", reason: "used" });
        return;
      }
      inviteService.dropInviteCache(code, accepted.host_user_id);

      matchmaking.dropFromQueue(accepted.host_user_id);
      matchmaking.dropFromQueue(guestId);

      send(hostWs, { t: "invite.connected", code, guest: guestId });
      send(ws, { t: "invite.connected", code, host: accepted.host_user_id });

      matchmaking.startGame(String(accepted.host_user_id), String(guestId)).catch((error) =>
        console.error("startGame error:", error)
      );
    } catch (error) {
      console.error("invite_accept error:", error);
      send(ws, { t: "invite.invalid", reason: "server_error" });
    }
  },
});
