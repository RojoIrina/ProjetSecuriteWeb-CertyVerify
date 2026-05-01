// ================================================================
// ERROR HANDLER — Global Express error middleware
// Catches all errors, returns structured JSON responses
// Hides stack traces in production
// ================================================================
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { env } from '../config/env.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log all errors
  console.error(`[ERROR] ${err.message}`, {
    name: err.name,
    stack: env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Known operational errors (expected, handled)
  if (err instanceof AppError) {
    const response: Record<string, unknown> = {
      success: false,
      error: err.message,
    };

    // Include validation details if available
    if ('errors' in err && typeof (err as any).errors === 'object') {
      response.errors = (err as any).errors;
    }

    res.status(err.statusCode).json(response);
    return;
  }

  // Unknown errors (bugs) — never expose details in production
  res.status(500).json({
    success: false,
    error:
      env.NODE_ENV === 'production'
        ? 'Erreur interne du serveur'
        : err.message,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}
