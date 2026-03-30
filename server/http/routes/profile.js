import { getUserCoinTransactions, getUserProfile } from "../../db.js";

export const registerProfileRoute = ({ app }) => {
  app.get("/profile/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9]+$/.test(String(id || ""))) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      const profile = await getUserProfile(id);
      return res.json({ ok: true, profile });
    } catch (error) {
      console.error("profile error:", error);
      return res.status(500).json({ ok: false });
    }
  });

  app.get("/profile/:id/coin-history", async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9]+$/.test(String(id || ""))) {
        return res.status(400).json({ ok: false, error: "invalid id" });
      }
      const limit = Number(req.query?.limit || 20);
      const history = await getUserCoinTransactions(id, limit);
      return res.json({ ok: true, history });
    } catch (error) {
      console.error("coin history error:", error);
      return res.status(500).json({ ok: false });
    }
  });
};
