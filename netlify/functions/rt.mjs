// Realtime-протокол игры поверх HTTP-поллинга (замена WebSocket для Netlify).
// POST /rt/connect -> { sid }        — создать сессию
// POST /rt/send    { sid, msg }      — отправить сообщение протокола
// POST /rt/poll    { sid }           — забрать входящие сообщения
import { rtConnect, rtPoll, rtSend } from "../../server/realtime/core.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const action = url.pathname.split("/").filter(Boolean).pop();

  let body = {};
  try {
    body = await req.json();
  } catch {}

  try {
    if (action === "connect") {
      return json(await rtConnect());
    }
    const sid = typeof body.sid === "string" ? body.sid : "";
    if (action === "poll") {
      const result = await rtPoll(sid);
      return json(result, result.gone ? 410 : 200);
    }
    if (action === "send") {
      const result = await rtSend(sid, body.msg);
      return json(result, result.gone ? 410 : 200);
    }
    return json({ ok: false, error: "unknown_action" }, 404);
  } catch (error) {
    console.error("rt function error:", error);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

export const config = {
  path: "/rt/*",
};
