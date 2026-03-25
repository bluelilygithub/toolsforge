const rateLimit = require('express-rate-limit');

// Mutable config — seeded from DB at startup, updated live by admin saves
const rateLimitConfig = {
  loginMax: 5,
};

function updateRateLimitConfig(cfg) {
  Object.assign(rateLimitConfig, cfg);
}

// max as a function — evaluated per request, so config changes take effect immediately
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: () => rateLimitConfig.loginMax,
  message: { error: 'Too many login attempts — please try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Register — slightly more generous; invite-only flow means this is rarely hit
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests — please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Password reset — prevent email enumeration at scale
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many requests — please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, registerLimiter, resetLimiter, rateLimitConfig, updateRateLimitConfig };
