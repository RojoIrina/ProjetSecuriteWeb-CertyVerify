// ================================================================
// CERTIFICATE SERVICE — Issuance, verification, and revocation
//
// This service orchestrates the full certificate lifecycle:
//   1. ISSUE: canonicalize → hash → sign → store
//   2. VERIFY: load → re-hash canonical data → verify signature
//   3. REVOKE: mark as revoked with timestamp and reason
//
// Now uses Repository layer for all data access.
// ================================================================
import * as certRepo from '../repositories/certificate.repository.js';
import * as keypairRepo from '../repositories/keypair.repository.js';
import * as userRepo from '../repositories/user.repository.js';
import * as moduleRepo from '../repositories/module.repository.js';
import * as verificationRepo from '../repositories/verification.repository.js';
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../errors/AppError.js';
import * as cryptoService from './crypto.service.js';
import { decryptPrivateKey } from './keyEncryption.service.js'; // FIX faille #3
import type { CertificatePayload } from '../types/index.js';
import type { Prisma } from '@prisma/client';
import type { VerificationMethod, VerificationResult } from '@prisma/client';

/**
 * Issue a new digitally signed certificate.
 *
 * Flow:
 *   1. Validate student exists and has completed all modules
 *   2. Load institution's active RSA key pair
 *   3. Canonicalize certificate data (deterministic JSON)
 *   4. Hash with SHA-256 (irreversible fingerprint)
 *   5. Sign hash with RSA-2048 private key
 *   6. Store certificate with hash + signature + canonical data
 */
export async function issueCertificate(params: {
  studentId: string;
  institutionId: string;
  issuedBy: string; // Admin user ID
  title: string;
}) {
  // 1. Validate student
  const student = await userRepo.findByIdFull(params.studentId);

  if (!student || student.role !== 'student') {
    throw new NotFoundError('Étudiant', params.studentId);
  }
  if (student.institutionId !== params.institutionId) {
    throw new ForbiddenError('Cet étudiant n’appartient pas à cette institution');
  }

  const activeCertificate = await certRepo.findFirst({
    studentId: params.studentId,
    institutionId: params.institutionId,
    revokedAt: null,
  });
  if (activeCertificate) {
    throw new ConflictError('Un certificat actif existe déjà pour cet étudiant');
  }

  // 2. Load active key pair for institution
  const keyPair = await keypairRepo.findActiveByInstitution(params.institutionId);

  if (!keyPair) {
    throw new ValidationError('Aucune clé de signature active pour cette institution');
  }

  // 3. Generate unique ID
  const certificateUid = cryptoService.generateCertificateUid();

  // 4. Prepare canonical payload
  const payload: CertificatePayload = {
    certificateUid,
    studentId: student.id,
    studentName: student.fullName,
    institutionId: params.institutionId,
    title: params.title,
    issuedAt: new Date().toISOString(),
  };

  // 5. Canonicalize → Hash → Sign
  const canonicalJson = cryptoService.canonicalize(payload);
  const documentHash = cryptoService.hashDocument(canonicalJson);
  // FIX faille #3 — Déchiffrer la clé privée avant utilisation (jamais utilisée en clair depuis la DB)
  const decryptedPrivateKey = decryptPrivateKey(keyPair.privateKeyRef);
  const digitalSignature = cryptoService.signHash(documentHash, decryptedPrivateKey);

  // 6. Generate student access key (HMAC-derived secret)
  const accessKey = cryptoService.generateAccessKey(certificateUid, student.id);

  // 7. Store in database
  const certificate = await certRepo.create({
    certificateUid,
    studentId: student.id,
    institutionId: params.institutionId,
    issuedBy: params.issuedBy,
    keyPairId: keyPair.id,
    title: params.title,
    studentName: student.fullName,
    documentHash,
    digitalSignature,
    canonicalData: payload as unknown as Prisma.InputJsonValue,
    status: 'signed',
    accessKey,
  });

  return { ...certificate, accessKey };
}

/**
 * Auto-issue a certificate when a student completes all modules.
 * Checks if ALL active modules for the institution are completed.
 * Returns the certificate if issued, null if not ready.
 */
export async function autoIssueIfReady(
  studentId: string,
  institutionId: string,
  issuedBy: string
) {
  // Check if student already has a certificate
  const existing = await certRepo.findFirst({
    studentId, institutionId, revokedAt: null,
  });
  if (existing) return null; // Already has one

  const allModules = await moduleRepo.findManyActive(institutionId);
  const requiredModules = allModules.filter(module => module.isRequired);
  const modulesToComplete = requiredModules.length > 0 ? requiredModules : allModules;
  if (modulesToComplete.length === 0) return null;

  // Get student's progress
  const modulesWithProgress = await moduleRepo.findWithUserModules(studentId, institutionId);
  const requiredIds = new Set(modulesToComplete.map(module => module.id));
  const completedCount = modulesWithProgress.filter(
    m => requiredIds.has(m.id) && m.userModules.some(um => um.status === 'completed')
  ).length;

  if (completedCount < modulesToComplete.length) return null;

  const requestedIssuer = await userRepo.findByIdFull(issuedBy);
  const systemIssuer = requestedIssuer?.role === 'admin'
    ? requestedIssuer
    : await userRepo.findActiveAdminByInstitution(institutionId);

  if (!systemIssuer) {
    throw new ValidationError('Aucun administrateur actif disponible pour émettre le certificat');
  }

  // All modules completed! Auto-issue certificate
  return issueCertificate({
    studentId,
    institutionId,
    issuedBy: systemIssuer.id,
    title: 'Architecture & Sécurité des Systèmes Numériques',
  });
}

/**
 * Download/access a certificate using the student's access key.
 * This is a PUBLIC endpoint — no auth needed, but requires the access key.
 */
export async function downloadCertificate(uid: string, accessKey: string) {
  const certificate = await certRepo.findByUidWithStudent(uid);

  if (!certificate) {
    throw new NotFoundError('Certificat', uid);
  }

  // Verify access key
  const isValid = cryptoService.verifyAccessKey(
    certificate.certificateUid,
    certificate.studentId,
    accessKey
  );

  if (!isValid) {
    throw new ForbiddenError('Clé d\'accès invalide');
  }

  // Update status to delivered on first access
  if (certificate.status === 'signed') {
    await certRepo.update(certificate.id, { status: 'delivered' });
  }

  // Return full certificate data (including signature info for PDF)
  const { keyPair, accessKey: _accessKey, digitalSignature: _digitalSignature, ...rest } = certificate;
  return { ...rest, status: certificate.status === 'signed' ? 'delivered' : certificate.status };
}

/**
 * Verify a certificate's authenticity.
 *
 * This is the PUBLIC endpoint — anyone can verify.
 *
 * Verification process:
 *   1. Look up certificate by UID
 *   2. Check revocation/expiration status
 *   3. Re-canonicalize the stored canonical data
 *   4. Re-compute SHA-256 hash
 *   5. Verify RSA signature using institution's public key
 *   6. Log the verification attempt
 */
export async function verifyCertificate(
  uid: string,
  method: VerificationMethod = 'id_lookup',
  meta?: { ipAddress?: string; userAgent?: string; qrSig?: string }
) {
  // 1. Look up certificate
  const certificate = await certRepo.findByUid(uid);

  let result: VerificationResult;
  let details: Record<string, unknown> = {};

  if (!certificate) {
    result = 'not_found';
    // Log and return early
    await logVerification(null, uid, method, result, meta);
    return { valid: false, result, certificate: null };
  }

  // 2. Check revocation
  if (certificate.revokedAt) {
    result = 'revoked';
    details = { revokedAt: certificate.revokedAt, reason: certificate.revocationReason };
    await logVerification(certificate.id, uid, method, result, meta);
    return { valid: false, result, details, certificate: sanitizeCert(certificate) };
  }

  // 3. Check expiration
  if (certificate.expiresAt && certificate.expiresAt < new Date()) {
    result = 'expired';
    await logVerification(certificate.id, uid, method, result, meta);
    return { valid: false, result, certificate: sanitizeCert(certificate) };
  }

  // 4. QR signature verification (if QR scan method)
  if (method === 'qr_scan' && meta?.qrSig) {
    const qrValid = cryptoService.verifyQRSignature(uid, meta.qrSig);
    if (!qrValid) {
      result = 'invalid';
      details = { reason: 'QR code signature invalide' };
      await logVerification(certificate.id, uid, method, result, meta);
      return { valid: false, result, details };
    }
  }

  // 5. Re-compute hash from stored canonical data
  const canonicalData = certificate.canonicalData as unknown as CertificatePayload;
  const canonicalJson = cryptoService.canonicalize(canonicalData);
  const recomputedHash = cryptoService.hashDocument(canonicalJson);

  // 6. Verify the hash matches
  if (recomputedHash !== certificate.documentHash) {
    result = 'invalid';
    details = { reason: 'Hash du document altéré — intégrité compromise' };
    await logVerification(certificate.id, uid, method, result, meta);
    return { valid: false, result, details };
  }

  // 7. Verify RSA signature
  const signatureValid = cryptoService.verifySignature(
    recomputedHash,
    certificate.digitalSignature,
    certificate.keyPair.publicKeyPem
  );

  if (!signatureValid) {
    result = 'invalid';
    details = { reason: 'Signature numérique invalide — document potentiellement falsifié' };
    await logVerification(certificate.id, uid, method, result, meta);
    return { valid: false, result, details };
  }

  // ✅ All checks passed
  result = 'valid';
  await logVerification(certificate.id, uid, method, result, meta);

  return {
    valid: true,
    result,
    certificate: sanitizeCert(certificate),
  };
}

/** Revoke a certificate (admin action) */
export async function revokeCertificate(
  certificateId: string,
  reason: string,
  _revokedBy: string
) {
  const cert = await certRepo.findById(certificateId);
  if (!cert) throw new NotFoundError('Certificat', certificateId);
  if (cert.revokedAt) throw new ValidationError('Ce certificat est déjà révoqué');

  return certRepo.update(certificateId, {
    revokedAt: new Date(),
    revocationReason: reason,
  });
}

/** List certificates with optional filters */
export async function listCertificates(filters?: {
  studentId?: string;
  institutionId?: string;
  limit?: number;
  offset?: number;
}) {
  const certs = await certRepo.findMany(filters);
  return certs.map(cert => sanitizeCert(cert));
}

/** Get a single certificate by ID */
export async function getCertificateById(id: string) {
  const cert = await certRepo.findById(id);
  if (!cert) throw new NotFoundError('Certificat', id);
  return cert;
}

// ─── Helpers ───

/** Remove sensitive fields before sending to client */
function sanitizeCert(cert: Record<string, unknown>) {
  const { keyPair: _keyPair, accessKey: _accessKey, digitalSignature: _digitalSignature, ...rest } = cert;
  return {
    ...rest,
    keyPair: undefined,
    accessKey: undefined,
    digitalSignature: undefined, // Don't expose raw signature to public
  };
}

/** Log verification attempt */
async function logVerification(
  certificateId: string | null,
  certificateUid: string,
  method: VerificationMethod,
  result: VerificationResult,
  meta?: { ipAddress?: string; userAgent?: string }
) {
  try {
    await verificationRepo.create({
      certificateId,
      certificateUid,
      method,
      result,
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
    });
  } catch (err) {
    console.error('[VERIFY-LOG] Failed to log verification:', err);
  }
}
