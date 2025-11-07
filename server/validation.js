export function validateGameMove(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (!msg.gameId || typeof msg.gameId !== 'string') return false;
  if (!Number.isInteger(msg.i) || msg.i < 0 || msg.i > 8) return false;
  return true;
}

export function validateHelloMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (!msg.uid || typeof msg.uid !== 'string') return false;
  if (msg.name && typeof msg.name !== 'string') return false;
  if (msg.avatar && typeof msg.avatar !== 'string') return false;
  return true;
}

export function sanitizeString(str) {
  return str.replace(/[<>]/g, '').trim().substring(0, 100);
}