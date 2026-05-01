// ================================================================
// CERTIFICATE CONTROLLER — Issuance, listing, revocation
// ================================================================
import { Request, Response, NextFunction } from 'express';
import * as certificateService from '../services/certificate.service.js';
import * as cryptoService from '../services/crypto.service.js';
import * as auditService from '../services/audit.service.js';
import { env } from '../config/env.js';

export async function issue(req: Request, res: Response, next: NextFunction) {
  try {
    const cert = await certificateService.issueCertificate({
      studentId: req.body.studentId,
      institutionId: req.body.institutionId || req.user!.institutionId!,
      issuedBy: req.user!.id,
      title: req.body.title,
    });

    await auditService.logAudit({
      userId: req.user!.id,
      action: 'certificate.issued',
      resourceType: 'certificate',
      resourceId: cert.id,
      details: {
        certificateUid: cert.certificateUid,
        studentId: cert.studentId,
        studentName: cert.studentName,
      },
      ipAddress: req.ip,
    });

    // Generate QR code payload
    const qrPayload = cryptoService.generateSecureQRPayload(
      cert.certificateUid,
      env.CORS_ORIGIN
    );

    res.status(201).json({
      success: true,
      data: { ...cert, qrPayload },
    });
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { studentId, institutionId, limit, offset } = req.query as Record<string, string>;

    // Students can only see their own certificates
    const effectiveStudentId =
      req.user!.role === 'student' ? req.user!.id : studentId;

    const certs = await certificateService.listCertificates({
      studentId: effectiveStudentId,
      institutionId,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });

    res.json({ success: true, data: certs });
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const cert = await certificateService.getCertificateById(req.params.id);

    // Students can only see their own certificates
    if (req.user!.role === 'student' && cert.studentId !== req.user!.id) {
      res.status(403).json({ success: false, error: 'Accès interdit' });
      return;
    }

    // Generate QR payload for the certificate
    const qrPayload = cryptoService.generateSecureQRPayload(
      cert.certificateUid,
      env.CORS_ORIGIN
    );

    res.json({ success: true, data: { ...cert, qrPayload } });
  } catch (err) {
    next(err);
  }
}

export async function revoke(req: Request, res: Response, next: NextFunction) {
  try {
    const cert = await certificateService.revokeCertificate(
      req.params.id,
      req.body.reason,
      req.user!.id
    );

    await auditService.logAudit({
      userId: req.user!.id,
      action: 'certificate.revoked',
      resourceType: 'certificate',
      resourceId: cert.id,
      details: { reason: req.body.reason, certificateUid: cert.certificateUid },
      ipAddress: req.ip,
    });

    res.json({ success: true, data: cert });
  } catch (err) {
    next(err);
  }
}
