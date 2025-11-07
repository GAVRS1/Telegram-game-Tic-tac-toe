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

// Middleware для логирования
export function loggingMiddleware(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
}