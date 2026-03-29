export const registerConfigRoute = ({ app, port, publicUrl }) => {
  app.get("/config.json", (req, res) => {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
    const origin = `${proto}://${host}`;
    const webAppUrl = publicUrl || origin.replace(/^http:/, "https:");
    const wsUrl = (publicUrl || origin).replace(/^http/, "ws");
    res.json({ webAppUrl, wsUrl });
  });
};
