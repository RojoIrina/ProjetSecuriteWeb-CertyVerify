// ================================================================
// VERIFY CONTROLLER — Public verification endpoint (no auth)
// Anyone can verify a certificate using its UID
// ================================================================
import { Request, Response, NextFunction } from 'express';
import * as certificateService from '../services/certificate.service.js';
import type { VerificationMethod } from '@prisma/client';

/**
 * GET /api/verify/:uid
 * Public endpoint — no authentication required.
 *
 * Query params:
 *   ?sig=abc123  — QR HMAC signature (optional, for QR scan method)
 *   ?method=qr_scan  — verification method (optional)
 */
export async function verify(req: Request, res: Response, next: NextFunction) {
  try {
    const { uid } = req.params;
    const { sig, method } = req.query as Record<string, string>;

    const verificationMethod: VerificationMethod =
      sig ? 'qr_scan' :
      (method as VerificationMethod) || 'id_lookup';

    const result = await certificateService.verifyCertificate(
      uid.toUpperCase(),
      verificationMethod,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        qrSig: sig,
      }
    );

    const statusCode = result.valid ? 200 : result.result === 'not_found' ? 404 : 200;

    res.status(statusCode).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}
