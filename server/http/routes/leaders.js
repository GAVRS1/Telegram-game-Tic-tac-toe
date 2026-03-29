import { getLeaders } from "../../db.js";

export const registerLeadersRoute = ({ app }) => {
  app.get("/leaders", async (_req, res) => {
    try {
      const list = await getLeaders(20);
      res.json({ ok: true, leaders: list });
    } catch (error) {
      console.error("leaders error:", error);
      res.status(500).json({ ok: false });
    }
  });
};
