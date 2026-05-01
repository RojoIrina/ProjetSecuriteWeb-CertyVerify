// ================================================================
// CERTIFICATE ROUTES — Issuance, listing, revocation (auth required)
// ================================================================
import { Router } from 'express';
import { z } from 'zod';
import * as certificateController from '../controllers/certificate.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.guard.js';
import { validate } from '../middleware/validate.js';

const router = Router();

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

// POST   /api/certificates/:id/revoke — Revoke (admin only)
router.post('/:id/revoke', requireRole('admin'), validate({ params: uuidParam, body: revokeSchema }), certificateController.revoke);

export default router;
