import { ensureSchema } from "../../db.js";

export const registerInviteRoute = ({ app, inviteService }) => {
  app.post("/invite", async (req, res) => {
    try {
      const hostUserId = String(req.body?.host_user_id || req.body?.hostUserId || "").trim();
      if (!hostUserId) {
        return res.status(400).json({ ok: false, error: "host_user_id required" });
      }
      await ensureSchema();
      const invite = (await inviteService.getValidInviteByHost(hostUserId)) ||
        (await inviteService.createInviteRecord(hostUserId));
      if (!invite) {
        return res.status(500).json({ ok: false, error: "invite creation failed" });
      }
      inviteService.cacheInvite(invite);
      const link = inviteService.buildInviteLink(req, invite.code);
      return res.json({ ok: true, code: invite.code, link, expiresAt: invite.expires_at });
    } catch (error) {
      console.error("invite create error:", error);
      return res.status(500).json({ ok: false });
    }
  });
};
