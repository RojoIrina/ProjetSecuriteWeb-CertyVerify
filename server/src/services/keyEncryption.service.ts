// ================================================================
// KEY ENCRYPTION SERVICE — FIX faille #3
// Chiffre les clés privées RSA avant stockage en base de données
// Utilise AES-256-GCM (chiffrement authentifié)
// ================================================================
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/**
 * Dérive une clé AES-256 à partir du ACCESS_KEY_SECRET.
 * En production, cette clé devrait venir d'un HSM ou KMS.
 */
function getMasterKey(): Buffer {
  return crypto.createHash('sha256').update(env.ACCESS_KEY_SECRET).digest();
}

/**
 * Chiffre une clé PEM avec AES-256-GCM avant stockage en base.
 * Le résultat est un JSON serialisé contenant iv, tag et data.
 */
export function encryptPrivateKey(pemContent: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(pemContent, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    v: 1, // version pour migrations futures
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

/**
 * Déchiffre une clé PEM depuis la base de données.
 * Vérifie l'authenticité via le tag GCM (intégrité garantie).
 */
export function decryptPrivateKey(encryptedJson: string): string {
  // Support clés non chiffrées (migration legacy — PEM commence par -----BEGIN)
  if (encryptedJson.trim().startsWith('-----BEGIN')) {
    return encryptedJson;
  }

  const { iv, tag, data } = JSON.parse(encryptedJson);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getMasterKey(),
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  return Buffer.concat([
    decipher.update(Buffer.from(data, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
