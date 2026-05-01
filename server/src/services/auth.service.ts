// ================================================================
// AUTH SERVICE — bcrypt + JWT RS256
//
// Security design decisions:
// - bcrypt (cost 12): ~250ms per hash. Intentionally slow to resist
//   GPU brute-force. SHA-256 would allow ~10 billion guesses/sec on GPU.
// - JWT RS256 (asymmetric): Private key signs, public key verifies.
//   Even if the public key leaks, tokens cannot be forged.
// - Short-lived access tokens (15min): Limits damage window if stolen.
// - Refresh tokens stored hashed in DB: Enables explicit revocation.
// ================================================================
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { UnauthorizedError, ConflictError, NotFoundError } from '../errors/AppError.js';
import type { TokenPair, AuthUser } from '../types/index.js';
import type { UserRole } from '@prisma/client';

// Load RSA keys at startup
const JWT_PRIVATE_KEY = fs.readFileSync(path.resolve(env.JWT_PRIVATE_KEY_PATH), 'utf-8');
const JWT_PUBLIC_KEY = fs.readFileSync(path.resolve(env.JWT_PUBLIC_KEY_PATH), 'utf-8');

/**
 * Hash a password with bcrypt.
 *
 * Why bcrypt over SHA-256 for passwords?
 * - SHA-256: ~10 billion hashes/sec on a modern GPU → 8-char password cracked in minutes
 * - bcrypt (cost 12): ~250ms per hash → 8-char password would take centuries
 * - bcrypt includes a random salt automatically (no separate salt storage needed)
 */
async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, env.BCRYPT_ROUNDS);
}

/**
 * Verify a password against its bcrypt hash.
 * Uses constant-time comparison internally (timing-safe).
 */
async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/** Generate JWT access token (short-lived, 15min default) */
function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, institutionId: user.institutionId },
    JWT_PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: env.JWT_ACCESS_EXPIRY }
  );
}

/** Generate opaque refresh token (crypto-random, stored hashed in DB) */
function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

/** Hash refresh token before storing in DB (so a DB leak doesn't give session access) */
function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ─── Public API ───

export async function register(
  email: string,
  password: string,
  fullName: string,
  role: UserRole = 'student',
  institutionId?: string
): Promise<TokenPair> {
  // Check uniqueness
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new ConflictError('Un compte avec cet email existe déjà');
  }

  const passwordHash = await hashPassword(password);
  const refreshToken = generateRefreshToken();

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName,
      role,
      institutionId: institutionId ?? null,
      refreshToken: hashRefreshToken(refreshToken),
    },
  });

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    institutionId: user.institutionId,
  };

  return {
    accessToken: signAccessToken(authUser),
    refreshToken,
  };
}

export async function login(email: string, password: string): Promise<TokenPair & { user: AuthUser }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    // Generic message to prevent user enumeration
    throw new UnauthorizedError('Email ou mot de passe incorrect');
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    throw new UnauthorizedError('Email ou mot de passe incorrect');
  }

  const refreshToken = generateRefreshToken();

  // Update last login and refresh token
  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      refreshToken: hashRefreshToken(refreshToken),
    },
  });

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    institutionId: user.institutionId,
  };

  return {
    accessToken: signAccessToken(authUser),
    refreshToken,
    user: authUser,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  const hashedToken = hashRefreshToken(refreshToken);

  const user = await prisma.user.findFirst({
    where: { refreshToken: hashedToken, isActive: true },
  });

  if (!user) {
    throw new UnauthorizedError('Refresh token invalide ou expiré');
  }

  // Rotate refresh token (one-time use)
  const newRefreshToken = generateRefreshToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: hashRefreshToken(newRefreshToken) },
  });

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    institutionId: user.institutionId,
  };

  return {
    accessToken: signAccessToken(authUser),
    refreshToken: newRefreshToken,
  };
}

export async function logout(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: null },
  });
}

export async function getUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      institutionId: true,
      institution: { select: { id: true, name: true } },
      lastLoginAt: true,
      createdAt: true,
    },
  });

  if (!user) throw new NotFoundError('Utilisateur', userId);
  return user;
}
