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
  creditHours: z.number().int().min(0).optional(),
  institutionId: z.string().uuid().optional(),
});

const updateModuleSchema = z.object({
  title: z.string().min(3).max(255).optional(),
  description: z.string().optional(),
  creditHours: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

const uuidParam = z.object({ id: z.string().uuid('ID invalide') });

// GET    /api/modules          — List all (any authenticated user)
router.get('/', moduleController.list);

// GET    /api/modules/:id      — Get one
router.get('/:id', validate({ params: uuidParam }), moduleController.getById);

// POST   /api/modules          — Create (admin only)
router.post('/', requireRole('admin'), validate({ body: createModuleSchema }), moduleController.create);

// PUT    /api/modules/:id      — Update (admin only)
router.put('/:id', requireRole('admin'), validate({ params: uuidParam, body: updateModuleSchema }), moduleController.update);

// DELETE /api/modules/:id      — Soft delete (admin only)
router.delete('/:id', requireRole('admin'), validate({ params: uuidParam }), moduleController.remove);

export default router;
