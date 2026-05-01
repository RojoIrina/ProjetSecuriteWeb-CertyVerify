// ================================================================
// VERIFY ROUTES — Public verification (NO authentication)
// Anyone can verify a certificate by its UID
// ================================================================
import { Router } from 'express';
import { z } from 'zod';
import * as verifyController from '../controllers/verify.controller.js';
import { validate } from '../middleware/validate.js';
import { verifyLimiter } from '../middleware/rate.limiter.js';

const router = Router();

const uidParam = z.object({
  uid: z.string().min(5).max(12).transform(v => v.toUpperCase()),
});

// GET /api/verify/:uid — Public, rate-limited (30/15min)
router.get('/:uid', verifyLimiter, validate({ params: uidParam }), verifyController.verify);

export default router;
