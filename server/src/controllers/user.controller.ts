// ================================================================
// USER CONTROLLER — Admin CRUD for user management
// ================================================================
import { Request, Response, NextFunction } from 'express';
import * as userService from '../services/user.service.js';
import * as auditService from '../services/audit.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { role, institutionId } = req.query as Record<string, string>;
    const users = await userService.listUsers({
      role: role as any,
      institutionId,
    });
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.getUserById(req.params.id);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await userService.createUser(req.body);

    await auditService.logAudit({
      userId: req.user!.id,
      action: 'user.created',
      resourceType: 'user',
      resourceId: result.user.id,
      details: { email: req.body.email, role: req.body.role },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.updateUser(req.params.id, req.body);

    await auditService.logAudit({
      userId: req.user!.id,
      action: 'user.updated',
      resourceType: 'user',
      resourceId: req.params.id,
      details: req.body,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await userService.deleteUser(req.params.id);

    await auditService.logAudit({
      userId: req.user!.id,
      action: 'user.deleted',
      resourceType: 'user',
      resourceId: req.params.id,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { message: 'Utilisateur désactivé' } });
  } catch (err) {
    next(err);
  }
}

export async function toggleModule(req: Request, res: Response, next: NextFunction) {
  try {
    const { moduleId } = req.body;
    const userId = req.params.id || req.user!.id;
    const result = await userService.toggleModuleCompletion(userId, moduleId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
