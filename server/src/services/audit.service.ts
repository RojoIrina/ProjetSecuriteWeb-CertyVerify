// ================================================================
// AUDIT SERVICE — Immutable audit trail for all sensitive operations
// Every action (login, cert issuance, revocation) is logged permanently
// ================================================================
import { prisma } from '../config/database.js';

export type AuditAction =
  | 'user.login'
  | 'user.logout'
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'certificate.issued'
  | 'certificate.revoked'
  | 'certificate.verified'
  | 'keypair.generated'
  | 'keypair.rotated'
  | 'module.created'
  | 'module.updated'
  | 'module.deleted';

interface AuditEntry {
  userId?: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Log an action to the immutable audit trail.
 * This is fire-and-forget — should never block the main operation.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditTrail.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        details: entry.details ?? null,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    // Never let audit failures crash the application
    console.error('[AUDIT] Failed to write audit log:', error);
  }
}

/** Query audit trail with pagination */
export async function getAuditLogs(options: {
  userId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}) {
  const { userId, action, limit = 50, offset = 0 } = options;

  return prisma.auditTrail.findMany({
    where: {
      ...(userId && { userId }),
      ...(action && { action }),
    },
    orderBy: { performedAt: 'desc' },
    take: limit,
    skip: offset,
    include: {
      user: { select: { fullName: true, email: true } },
    },
  });
}
