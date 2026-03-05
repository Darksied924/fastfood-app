const { errorResponse } = require('../utils/response.util');

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getClientIp = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor && typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.connection?.remoteAddress || 'unknown';
};

const createRateLimiter = ({ windowMs, maxRequests, keyGenerator, message }) => {
  const store = new Map();
  const intervalMs = toPositiveInt(windowMs, 15 * 60 * 1000);
  const max = toPositiveInt(maxRequests, 100);
  const errorMessage = message || 'Too many requests. Please try again later.';

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator ? keyGenerator(req) : getClientIp(req);
    const entry = store.get(key);

    if (!entry || now >= entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + intervalMs });
      return next();
    }

    if (entry.count >= max) {
      const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(Math.max(retryAfterSeconds, 1)));
      return errorResponse(res, errorMessage, 429);
    }

    entry.count += 1;
    return next();
  };
};

module.exports = {
  createRateLimiter,
  getClientIp
};
