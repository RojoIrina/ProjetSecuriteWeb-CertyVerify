// ================================================================
// AUTH GUARD — JWT RS256 verification middleware
// Extracts user from Bearer token, attaches to req.user
// ================================================================
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError.js';
import type { AuthUser } from '../types/index.js';
import type { UserRole } from '@prisma/client';

// Load RSA public key once at startup for JWT verification
const publicKeyPath = path.resolve(env.JWT_PUBLIC_KEY_PATH);
let JWT_PUBLIC_KEY: string;

try {
  JWT_PUBLIC_KEY = fs.readFileSync(publicKeyPath, 'utf-8');
} catch {
  console.error(`❌ JWT public key not found at: ${publicKeyPath}`);
  console.error('   Run: openssl genrsa -out keys/jwt-private.pem 2048');
  console.error('   Run: openssl rsa -in keys/jwt-private.pem -pubout -out keys/jwt-public.pem');
  process.exit(1);
}

/**
 * Middleware: Require valid JWT in Authorization header.
 * Attaches decoded user to req.user.
 *
 * Security notes:
 * - Uses RS256 (asymmetric) instead of HS256 (symmetric).
 *   This means the signing key (private) and verification key (public)
 *   are different. Even if the public key leaks, tokens cannot be forged.
 * - Algorithm is explicitly specified to prevent "alg: none" attacks.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Token d\'authentification manquant');
  }

  const token = header.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_PUBLIC_KEY, {
      algorithms: ['RS256'], // Explicitly restrict to RS256 — prevents alg confusion
    }) as AuthUser;

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      institutionId: decoded.institutionId,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Token expiré — veuillez vous reconnecter');
    }
    throw new UnauthorizedError('Token invalide');
  }
}

/**
 * Factory: Create a middleware that requires specific role(s).
 * Must be used AFTER requireAuth.
 *
 * Usage: requireRole('admin') or requireRole('admin', 'verifier')
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    if (!roles.includes(req.user.role)) {
      throw new ForbiddenError(
        `Rôle requis: ${roles.join(' ou ')}. Votre rôle: ${req.user.role}`
      );
    }
    next();
  };
}
