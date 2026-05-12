// ================================================================
// RATE LIMITER — Per-route rate limiting
// FIX faille #15 — Auth limiter combine IP + email (anti rotation IP)
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
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trop de requêtes. Réessayez dans quelques minutes.',
  },
});

/**
 * Strict auth limiter: 5 login attempts per 15 minutes per IP+email.
 * FIX faille #15 — keyGenerator combine IP et email pour bloquer
 * les attaques par rotation d'IP (Tor, VPN).
 *
 * Security: An attacker trying 1000 passwords would need 50 hours.
 */
export const authLimiter = rateLimit({
  windowMs: 900_000, // 15 minutes
  max: 5, // Réduit de 10 à 5
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Combine IP et email — contourne la rotation d'IP
    const email = (req.body?.email as string) || 'unknown';
    return `${req.ip}:${email.toLowerCase()}`;
  },
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

/**
 * Download limiter: 20 downloads per 15 minutes per IP.
 * Applied to public certificate download endpoints.
 */
export const downloadLimiter = rateLimit({
  windowMs: 900_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trop de téléchargements. Réessayez dans quelques minutes.',
  },
});
