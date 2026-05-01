// ================================================================
// USER SERVICE — CRUD operations for user management
// All mutations are admin-only (enforced in routes via middleware)
// ================================================================
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { NotFoundError, ConflictError } from '../errors/AppError.js';
import type { UserRole } from '@prisma/client';

// Fields to never return in API responses
const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  institutionId: true,
  institution: { select: { id: true, name: true } },
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  userModules: {
    select: {
      moduleId: true,
      status: true,
      completedAt: true,
      module: { select: { id: true, title: true } },
    },
  },
} as const;

export async function listUsers(filters?: { role?: UserRole; institutionId?: string }) {
  return prisma.user.findMany({
    where: {
      ...(filters?.role && { role: filters.role }),
      ...(filters?.institutionId && { institutionId: filters.institutionId }),
    },
    select: USER_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: USER_SELECT,
  });
  if (!user) throw new NotFoundError('Utilisateur', id);
  return user;
}

export async function createUser(data: {
  email: string;
  fullName: string;
  role: UserRole;
  institutionId?: string;
}) {
  // Check uniqueness
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new ConflictError('Un utilisateur avec cet email existe déjà');
  }

  // Generate cryptographically secure temporary password
  const tempPassword = crypto.randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(tempPassword, env.BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      fullName: data.fullName,
      role: data.role,
      passwordHash,
      institutionId: data.institutionId ?? null,
    },
    select: USER_SELECT,
  });

  // Return user + temp password (only shown once)
  return { user, temporaryPassword: tempPassword };
}

export async function updateUser(
  id: string,
  data: { email?: string; fullName?: string; role?: UserRole; isActive?: boolean }
) {
  // Check existence
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Utilisateur', id);

  // Check email uniqueness if changing
  if (data.email && data.email !== existing.email) {
    const conflict = await prisma.user.findUnique({ where: { email: data.email } });
    if (conflict) throw new ConflictError('Un utilisateur avec cet email existe déjà');
  }

  return prisma.user.update({
    where: { id },
    data: {
      ...(data.email && { email: data.email }),
      ...(data.fullName && { fullName: data.fullName }),
      ...(data.role && { role: data.role }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
    select: USER_SELECT,
  });
}

export async function deleteUser(id: string) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Utilisateur', id);

  // Soft delete: deactivate instead of removing (preserves audit trail)
  return prisma.user.update({
    where: { id },
    data: { isActive: false },
    select: USER_SELECT,
  });
}

/** Toggle module completion for a student */
export async function toggleModuleCompletion(userId: string, moduleId: string) {
  const existing = await prisma.userModule.findUnique({
    where: { userId_moduleId: { userId, moduleId } },
  });

  if (!existing) {
    // Enroll and mark completed
    return prisma.userModule.create({
      data: { userId, moduleId, status: 'completed', completedAt: new Date() },
    });
  }

  if (existing.status === 'completed') {
    // Toggle back to enrolled
    return prisma.userModule.update({
      where: { userId_moduleId: { userId, moduleId } },
      data: { status: 'enrolled', completedAt: null },
    });
  }

  // Mark completed
  return prisma.userModule.update({
    where: { userId_moduleId: { userId, moduleId } },
    data: { status: 'completed', completedAt: new Date() },
  });
}
