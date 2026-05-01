// ================================================================
// CERTIFICATE SERVICE — Issuance, verification, and revocation
//
// This service orchestrates the full certificate lifecycle:
//   1. ISSUE: canonicalize → hash → sign → store
//   2. VERIFY: load → re-hash canonical data → verify signature
//   3. REVOKE: mark as revoked with timestamp and reason
// ================================================================
import { prisma } from '../config/database.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../errors/AppError.js';
import * as cryptoService from './crypto.service.js';
import type { CertificatePayload } from '../types/index.js';
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
  const student = await prisma.user.findUnique({
    where: { id: params.studentId },
    include: { userModules: true },
  });

  if (!student || student.role !== 'student') {
    throw new NotFoundError('Étudiant', params.studentId);
  }

  // 2. Load active key pair for institution
  const keyPair = await prisma.keyPair.findFirst({
    where: { institutionId: params.institutionId, isActive: true },
  });

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
  const digitalSignature = cryptoService.signHash(documentHash, keyPair.privateKeyRef);

  // 6. Store in database
  const certificate = await prisma.certificate.create({
    data: {
      certificateUid,
      studentId: student.id,
      institutionId: params.institutionId,
      issuedBy: params.issuedBy,
      keyPairId: keyPair.id,
      title: params.title,
      studentName: student.fullName,
      documentHash,
      digitalSignature,
      canonicalData: payload,
    },
    include: {
      student: { select: { id: true, fullName: true, email: true } },
      institution: { select: { id: true, name: true } },
    },
  });

  return certificate;
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
  const certificate = await prisma.certificate.findUnique({
    where: { certificateUid: uid },
    include: {
      keyPair: { select: { publicKeyPem: true } },
      student: { select: { fullName: true } },
      institution: { select: { name: true } },
    },
  });

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
  const canonicalData = certificate.canonicalData as CertificatePayload;
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
  revokedBy: string
) {
  const cert = await prisma.certificate.findUnique({ where: { id: certificateId } });
  if (!cert) throw new NotFoundError('Certificat', certificateId);
  if (cert.revokedAt) throw new ValidationError('Ce certificat est déjà révoqué');

  return prisma.certificate.update({
    where: { id: certificateId },
    data: {
      revokedAt: new Date(),
      revocationReason: reason,
    },
  });
}

/** List certificates with optional filters */
export async function listCertificates(filters?: {
  studentId?: string;
  institutionId?: string;
  limit?: number;
  offset?: number;
}) {
  return prisma.certificate.findMany({
    where: {
      ...(filters?.studentId && { studentId: filters.studentId }),
      ...(filters?.institutionId && { institutionId: filters.institutionId }),
    },
    include: {
      student: { select: { id: true, fullName: true, email: true } },
      institution: { select: { id: true, name: true } },
    },
    orderBy: { issuedAt: 'desc' },
    take: filters?.limit ?? 50,
    skip: filters?.offset ?? 0,
  });
}

/** Get a single certificate by ID */
export async function getCertificateById(id: string) {
  const cert = await prisma.certificate.findUnique({
    where: { id },
    include: {
      student: { select: { id: true, fullName: true, email: true } },
      institution: { select: { id: true, name: true } },
    },
  });
  if (!cert) throw new NotFoundError('Certificat', id);
  return cert;
}

// ─── Helpers ───

/** Remove sensitive fields before sending to client */
function sanitizeCert(cert: any) {
  const { keyPair, ...rest } = cert;
  return {
    ...rest,
    keyPair: undefined,
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
    await prisma.verificationLog.create({
      data: {
        certificateId,
        certificateUid,
        method,
        result,
        ipAddress: meta?.ipAddress ?? null,
        userAgent: meta?.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error('[VERIFY-LOG] Failed to log verification:', err);
  }
}
