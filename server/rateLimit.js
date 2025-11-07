const requestCounts = new Map();
const WINDOW_MS = 60000; // 1 минута
const MAX_REQUESTS = 100;

export function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }
  
  const requests = requestCounts.get(ip);
  const validRequests = requests.filter(time => time > windowStart);
  
  if (validRequests.length >= MAX_REQUESTS) {
    return false;
  }
  
  validRequests.push(now);
  requestCounts.set(ip, validRequests);
  
  // Очистка старых записей
  if (requestCounts.size > 1000) {
    for (const [key, times] of requestCounts.entries()) {
      if (times[times.length - 1] < windowStart) {
        requestCounts.delete(key);
      }
    }
  }
  
  return true;
}

export function getClientIP(req) {
  return req.headers['x-forwarded-for'] || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         'unknown';
}