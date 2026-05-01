// ================================================================
// USER ROUTES — Admin-only CRUD + student module toggling
// ================================================================
import { Router } from 'express';
import { z } from 'zod';
import * as userController from '../controllers/user.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.guard.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// All user routes require authentication
router.use(requireAuth);

const createUserSchema = z.object({
  email: z.string().email('Email invalide'),
  fullName: z.string().min(2, 'Nom trop court').max(255),
  role: z.enum(['admin', 'student', 'verifier']),
  institutionId: z.string().uuid().optional(),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(2).max(255).optional(),
  role: z.enum(['admin', 'student', 'verifier']).optional(),
  isActive: z.boolean().optional(),
});

const uuidParam = z.object({ id: z.string().uuid('ID invalide') });
const toggleModuleSchema = z.object({ moduleId: z.string().uuid('Module ID invalide') });

// GET    /api/users          — List all (admin only)
router.get('/', requireRole('admin'), userController.list);

// GET    /api/users/:id      — Get one (admin only)
router.get('/:id', requireRole('admin'), validate({ params: uuidParam }), userController.getById);

// POST   /api/users          — Create (admin only)
router.post('/', requireRole('admin'), validate({ body: createUserSchema }), userController.create);

// PUT    /api/users/:id      — Update (admin only)
router.put('/:id', requireRole('admin'), validate({ params: uuidParam, body: updateUserSchema }), userController.update);

// DELETE /api/users/:id      — Soft delete (admin only)
router.delete('/:id', requireRole('admin'), validate({ params: uuidParam }), userController.remove);

// POST   /api/users/:id/modules — Toggle module completion (admin or self)
router.post('/:id/modules', validate({ params: uuidParam, body: toggleModuleSchema }), userController.toggleModule);

// POST   /api/users/me/modules — Toggle own module completion (student)
router.post('/me/modules', validate({ body: toggleModuleSchema }), userController.toggleModule);

export default router;
