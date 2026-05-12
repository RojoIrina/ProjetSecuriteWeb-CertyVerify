// ================================================================
// MODULE ROUTES — CRUD for academic modules (admin + student read)
// ================================================================
import { Router } from 'express';
import { z } from 'zod';
import * as moduleController from '../controllers/module.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.guard.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.use(requireAuth);

const createModuleSchema = z.object({
  title: z.string().min(3, 'Titre trop court').max(255),
  description: z.string().optional(),
  content: z.string().max(50000).optional(),
  creditHours: z.number().int().min(0).optional(),
  order: z.number().int().min(0).optional(),
  duration: z.number().int().min(0).optional(),
  isRequired: z.boolean().optional(),
  institutionId: z.string().uuid().optional(),
});

const updateModuleSchema = z.object({
  title: z.string().min(3).max(255).optional(),
  description: z.string().optional(),
  content: z.string().max(50000).optional(),
  creditHours: z.number().int().min(0).optional(),
  order: z.number().int().min(0).optional(),
  duration: z.number().int().min(0).optional(),
  isRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const uuidParam = z.object({ id: z.string().uuid('ID invalide') });

// GET    /api/modules          — List all (any authenticated user)
router.get('/', moduleController.list);

// GET    /api/modules/progress  — Student progress across all modules
router.get('/progress', moduleController.progress);

// GET    /api/modules/students/progress — Admin progress overview
router.get('/students/progress', requireRole('admin'), moduleController.studentProgress);

// GET    /api/modules/:id      — Get one
router.get('/:id', validate({ params: uuidParam }), moduleController.getById);

// POST   /api/modules          — Create (admin only)
router.post('/', requireRole('admin'), validate({ body: createModuleSchema }), moduleController.create);

// PUT    /api/modules/:id      — Update (admin only)
router.put('/:id', requireRole('admin'), validate({ params: uuidParam, body: updateModuleSchema }), moduleController.update);

// DELETE /api/modules/:id      — Soft delete (admin only)
router.delete('/:id', requireRole('admin'), validate({ params: uuidParam }), moduleController.remove);

// POST   /api/modules/:id/enroll  — Student enrolls in a module
router.post('/:id/enroll', validate({ params: uuidParam }), moduleController.enroll);

// POST   /api/modules/:id/complete — Admin valide la complétion (FIX faille #5)
router.post('/:id/complete', requireRole('admin'), validate({ params: uuidParam }), moduleController.complete);

export default router;
