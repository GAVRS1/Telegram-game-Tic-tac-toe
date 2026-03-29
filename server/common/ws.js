export const send = (ws, obj) => {
  try {
    if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
  } catch {}
};
