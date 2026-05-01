// ================================================================
// VALIDATION MIDDLEWARE — Zod schema validation for Express
// Validates req.body, req.params, and req.query
// ================================================================
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../errors/AppError.js';

interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

/**
 * Factory: Create validation middleware from Zod schemas.
 * Parses and replaces request data with validated/coerced values.
 *
 * Usage:
 *   router.post('/users', validate({ body: createUserSchema }), controller)
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as any;
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as any;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          const path = issue.path.join('.');
          fieldErrors[path] = issue.message;
        }
        throw new ValidationError('Données invalides', fieldErrors);
      }
      throw err;
    }
  };
}
