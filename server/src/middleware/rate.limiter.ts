// ================================================================
// RATE LIMITER — Per-route rate limiting
// Protects against brute-force and L7 DDoS
// ================================================================
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * General rate limiter: 100 requests per 15 minutes per IP.
 * Applied globally to all routes.
 */
export const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,  // Return rate limit info in RateLimit-* headers
  legacyHeaders: false,   // Disable X-RateLimit-* headers
  message: {
    success: false,
    error: 'Trop de requêtes. Réessayez dans quelques minutes.',
  },
});

/**
 * Strict auth limiter: 10 login attempts per 15 minutes per IP.
 * Applied only to authentication endpoints.
 *
 * Security: Prevents brute-force password guessing.
 * An attacker trying 1000 passwords would need 25 hours.
 */
export const authLimiter = rateLimit({
  windowMs: 900_000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
  },
});

/**
 * Verification limiter: 30 verifications per 15 minutes per IP.
 * Public endpoint — more generous but still protected.
 */
export const verifyLimiter = rateLimit({
  windowMs: 900_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trop de vérifications. Réessayez dans quelques minutes.',
  },
});
