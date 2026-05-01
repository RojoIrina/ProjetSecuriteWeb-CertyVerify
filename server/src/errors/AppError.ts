// ================================================================
// CUSTOM ERRORS — Structured error hierarchy
// All errors extend AppError for consistent handling
// ================================================================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 — Invalid input from client */
export class ValidationError extends AppError {
  public readonly errors: Record<string, string>;

  constructor(message: string, errors: Record<string, string> = {}) {
    super(message, 400);
    this.errors = errors;
  }
}

/** 401 — Missing or invalid credentials */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentification requise') {
    super(message, 401);
  }
}

/** 403 — Authenticated but insufficient permissions */
export class ForbiddenError extends AppError {
  constructor(message = 'Accès interdit') {
    super(message, 403);
  }
}

/** 404 — Resource not found */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const msg = id
      ? `${resource} introuvable (id: ${id})`
      : `${resource} introuvable`;
    super(msg, 404);
  }
}

/** 409 — Resource already exists */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}
