import { getLeaders, getLeadersByAchievements, getLeadersByInvites } from "../../db.js";

export const registerLeadersRoute = ({ app }) => {
  app.get("/leaders", async (req, res) => {
    try {
      const metric = typeof req.query?.metric === "string" ? req.query.metric.trim().toLowerCase() : "wins";
      const metricHandlers = {
        wins: getLeaders,
        achievements: getLeadersByAchievements,
        invites: getLeadersByInvites,
      };

      const loader = metricHandlers[metric];
      if (!loader) {
        return res.status(400).json({ ok: false, error: "invalid metric", allowed: Object.keys(metricHandlers) });
      }

      const list = await loader(20);
      res.json({ ok: true, metric, leaders: list });
    } catch (error) {
      console.error("leaders error:", error);
      res.status(500).json({ ok: false });
    }
  });
};
