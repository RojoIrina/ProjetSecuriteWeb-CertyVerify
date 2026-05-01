// ================================================================
// CRYPTO SERVICE — RSA-2048 + SHA-256 + HMAC
//
// This is the cryptographic core of CertiVerify.
// Every function here directly impacts the integrity guarantee.
//
// Architecture:
//   1. CANONICALIZE — deterministic JSON from certificate data
//   2. HASH — SHA-256 of canonical JSON (irreversible fingerprint)
//   3. SIGN — RSA-2048 of hash using institution's private key
//   4. VERIFY — RSA-2048 of hash using institution's public key
//
// Why this order?
//   Signing the hash (not the raw data) is standard practice:
//   - RSA can only sign small data (<key_size bytes)
//   - SHA-256 output is always 32 bytes, regardless of input size
//   - This is the same approach used by TLS, PGP, and X.509
// ================================================================
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import type { CertificatePayload } from '../types/index.js';

/**
 * Generate an RSA-2048 key pair for an institution.
 *
 * Why RSA-2048?
 * - NIST/ANSSI recommended until 2030+
 * - 2048-bit modulus → ~112 bits of security
 * - Widely supported by institutional tools
 * - Alternative: ECDSA P-256 (faster, smaller keys) but less
 *   compatible with legacy systems
 *
 * Returns PEM-encoded keys.
 */
export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/**
 * Step 1: CANONICALIZE — Deterministic JSON serialization.
 *
 * Sorts keys alphabetically so that:
 *   { b: 2, a: 1 } and { a: 1, b: 2 }
 * both produce the exact same string.
 *
 * This is CRITICAL because:
 *   Same data → same canonical form → same hash → same signature
 *   Without canonicalization, key order differences would produce
 *   different hashes, breaking verification.
 */
export function canonicalize(payload: CertificatePayload): string {
  const sorted = Object.keys(payload)
    .sort()
    .reduce((acc, key) => {
      acc[key] = payload[key as keyof CertificatePayload];
      return acc;
    }, {} as Record<string, string>);
  return JSON.stringify(sorted);
}

/**
 * Step 2: HASH — SHA-256 digest of the canonical JSON.
 *
 * Properties:
 * - Deterministic: same input → same output, always
 * - Irreversible: impossible to recover input from hash
 * - Collision-resistant: P(collision) ≈ 1/2^128 (birthday bound)
 * - Avalanche effect: 1 bit change → ~50% of output bits flip
 *
 * Output: 64 hexadecimal characters (256 bits)
 *
 * Why SHA-256 and NOT MD5 or SHA-1?
 * - MD5: broken since 2004 (collisions found in seconds)
 * - SHA-1: broken since 2017 (SHAttered attack by Google)
 * - SHA-256: no known practical attacks, used by Bitcoin, TLS 1.3
 */
export function hashDocument(canonicalJson: string): string {
  return crypto
    .createHash('sha256')
    .update(canonicalJson, 'utf8')
    .digest('hex');
}

/**
 * Step 3: SIGN — RSA-2048 signature of the hash.
 *
 * Only the institution's private key can produce this signature.
 * Anyone with the public key can verify it.
 *
 * This is asymmetric cryptography:
 *   PRIVATE KEY → sign (kept secret in HSM/vault)
 *   PUBLIC KEY → verify (distributed freely)
 *
 * Output: Base64-encoded signature
 */
export function signHash(hash: string, privateKeyPem: string): string {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(hash);
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

/**
 * Step 4: VERIFY — Check signature validity using public key.
 *
 * Returns true if and only if:
 *   1. The hash matches the certificate's canonical data
 *   2. The signature was produced by the corresponding private key
 *
 * This function can be called by ANYONE — no secrets needed.
 */
export function verifySignature(
  hash: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(hash);
    verifier.end();
    return verifier.verify(publicKeyPem, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically secure certificate UID.
 *
 * Uses crypto.randomBytes instead of Math.random():
 * - Math.random(): PRNG seeded from Date.now(), predictable
 * - crypto.randomBytes(): CSPRNG from OS entropy pool, unpredictable
 *
 * Format: 9 uppercase alphanumeric characters (36^9 ≈ 1.01 × 10^14 combinations)
 */
export function generateCertificateUid(): string {
  return crypto.randomBytes(7).toString('base64url').substring(0, 9).toUpperCase();
}

/**
 * Generate HMAC-SHA256 signed QR code payload.
 *
 * The QR code contains both the certificate UID and a MAC (Message
 * Authentication Code). This prevents attackers from crafting fake
 * QR codes that link to valid-looking but unauthorized verify URLs.
 *
 * Why HMAC and not just the UID?
 *   Without HMAC: attacker scans QR → learns URL format → generates
 *   thousands of fake QR codes pointing to /verify?uid=BRUTE_FORCE
 *   With HMAC: each QR has a signature that only our server can produce
 */
export function generateSecureQRPayload(
  certificateUid: string,
  appUrl: string
): string {
  const hmac = crypto
    .createHmac('sha256', env.QR_HMAC_SECRET)
    .update(certificateUid)
    .digest('hex')
    .substring(0, 16);

  return `${appUrl}/verify?uid=${certificateUid}&sig=${hmac}`;
}

/**
 * Verify HMAC from QR code payload.
 *
 * Uses crypto.timingSafeEqual for comparison:
 *
 * Why timing-safe?
 *   A regular === comparison short-circuits at the first different byte.
 *   An attacker can measure response time to deduce correct bytes:
 *     "a..." → 0.1ms (fails at byte 0)
 *     "3..." → 0.2ms (fails at byte 1 — byte 0 was correct!)
 *   crypto.timingSafeEqual always takes the same time regardless of
 *   where the difference is, preventing this side-channel attack.
 */
export function verifyQRSignature(uid: string, sig: string): boolean {
  try {
    const expected = crypto
      .createHmac('sha256', env.QR_HMAC_SECRET)
      .update(uid)
      .digest('hex')
      .substring(0, 16);

    if (sig.length !== expected.length) return false;

    return crypto.timingSafeEqual(
      Buffer.from(sig, 'utf8'),
      Buffer.from(expected, 'utf8')
    );
  } catch {
    return false;
  }
}
