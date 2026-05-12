// ================================================================
// CERTIFICATE ROUTES — Issuance, listing, revocation (auth required)
// ================================================================
import { Router } from 'express';
import { z } from 'zod';
import * as certificateController from '../controllers/certificate.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.guard.js';
import { validate } from '../middleware/validate.js';
import { downloadLimiter } from '../middleware/rate.limiter.js';

const router = Router();

// ─── Public routes (no auth) ───
// GET /api/certificates/:uid/download?key=... — Download with access key (rate limited)
router.get('/:uid/download', downloadLimiter, certificateController.download);
router.get('/:uid/download.pdf', downloadLimiter, certificateController.downloadPublicPdf);

// ─── Protected routes ───
router.use(requireAuth);

const issueSchema = z.object({
  studentId: z.string().uuid('ID étudiant invalide'),
  institutionId: z.string().uuid().optional(),
  title: z.string().min(5, 'Titre trop court').max(500),
});

const revokeSchema = z.object({
  reason: z.string().min(10, 'Raison trop courte (min 10 caractères)').max(1000),
});

const uuidParam = z.object({ id: z.string().uuid('ID invalide') });

// POST   /api/certificates          — Issue new certificate (admin only)
router.post('/', requireRole('admin'), validate({ body: issueSchema }), certificateController.issue);

// GET    /api/certificates          — List (admin: all, student: own)
router.get('/', certificateController.list);

// GET    /api/certificates/:id      — Get one
router.get('/:id', validate({ params: uuidParam }), certificateController.getById);

// GET    /api/certificates/:id/pdf  — Backend-generated certificate PDF
router.get('/:id/pdf', validate({ params: uuidParam }), certificateController.downloadPdf);

// POST   /api/certificates/:id/revoke — Revoke (admin only)
router.post('/:id/revoke', requireRole('admin'), validate({ params: uuidParam, body: revokeSchema }), certificateController.revoke);

export default router;
