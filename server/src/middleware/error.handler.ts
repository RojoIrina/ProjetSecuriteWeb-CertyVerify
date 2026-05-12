// ================================================================
// ERROR HANDLER — Global Express error middleware
// FIX faille #12 — Ne jamais exposer stack traces ni détails internes
// Les erreurs sont loguées côté serveur uniquement
// ================================================================
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Logger TOUT côté serveur (stack trace comprise)
  console.error(`[ERROR] ${err.name}: ${err.message}`, {
    stack: err.stack,
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

  // Unknown errors (bugs) — JAMAIS exposer les détails, même en développement
  res.status(500).json({
    success: false,
    error: 'Erreur interne du serveur',
  });
}
