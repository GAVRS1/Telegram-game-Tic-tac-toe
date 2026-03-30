import { getAdminReferralDiagnostics } from "../../db.js";

export const registerAdminDiagnosticsRoute = ({ app }) => {
  app.get("/admin/diagnostics/referrals", async (_req, res) => {
    try {
      const diagnostics = await getAdminReferralDiagnostics();
      return res.json({ ok: true, ...diagnostics });
    } catch (error) {
      console.error("admin diagnostics error:", error);
      return res.status(500).json({ ok: false, error: "diagnostics_unavailable" });
    }
  });
};
