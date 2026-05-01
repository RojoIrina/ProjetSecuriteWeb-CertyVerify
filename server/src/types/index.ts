// ================================================================
// SHARED TYPES — TypeScript interfaces for the server
// ================================================================
import type { UserRole } from '@prisma/client';

/** Authenticated user attached to req by auth middleware */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  institutionId: string | null;
}

/** Extend Express Request to include authenticated user */
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Standard API response envelope */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errors?: Record<string, string>;
}

/** JWT token pair returned on login */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Certificate payload for canonicalization and signing */
export interface CertificatePayload {
  certificateUid: string;
  studentId: string;
  studentName: string;
  institutionId: string;
  title: string;
  issuedAt: string;
}
