import { getPool } from "./db.js";

const metrics = {
  activeConnections: 0,
  totalGames: 0,
  activeGames: 0,
  messagesReceived: 0,
  errors: 0
};

export function incrementMetric(metric) {
  if (metrics.hasOwnProperty(metric)) {
    metrics[metric]++;
  }
}

export function getMetrics() {
  return { ...metrics };
}

export function resetMetrics() {
  Object.keys(metrics).forEach(key => {
    metrics[key] = 0;
  });
}

export function loggingMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });

  next();
}

function normalizeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta;
}

function persistMonitoringEvent(eventName, meta) {
  const pool = getPool();
  if (!pool) return;
  pool
    .query(
      `
        INSERT INTO monitoring_events (event_name, meta)
        VALUES ($1, $2::jsonb);
      `,
      [eventName, JSON.stringify(normalizeMeta(meta))]
    )
    .catch((error) => {
      console.error("monitoring event persist error:", error);
    });
}

export function logStructuredEvent(eventName, payload = {}, { persist = true } = {}) {
  const event = {
    event: String(eventName || "unknown"),
    ts: new Date().toISOString(),
    ...normalizeMeta(payload),
  };
  console.log(JSON.stringify(event));

  if (persist) {
    persistMonitoringEvent(event.event, payload?.meta || payload);
  }
}

export function logReferralEvent(eventName, payload = {}) {
  logStructuredEvent(eventName, payload);
}

export function logCoinAward({ source, eventKey, userId, reason, amount, result, error = null, meta = {} }) {
  const isDeduplicated = result === "already_awarded";
  const eventName = isDeduplicated ? "coins_award_deduplicated" : "coins_awarded";
  const errorCode = error ? error.message || String(error) : null;

  logStructuredEvent(eventName, {
    source: source || "unknown",
    eventKey: eventKey || "none",
    userId: userId ?? null,
    reason: reason || "none",
    amount: amount ?? null,
    result: result || "unknown",
    error: errorCode,
    meta: normalizeMeta(meta),
  });
}
