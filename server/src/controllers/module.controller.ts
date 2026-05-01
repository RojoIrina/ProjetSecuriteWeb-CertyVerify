// ================================================================
// MODULE CONTROLLER — CRUD for academic modules
// ================================================================
import { Request, Response, NextFunction } from 'express';
import * as moduleService from '../services/module.service.js';
import * as auditService from '../services/audit.service.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { institutionId } = req.query as Record<string, string>;
    const modules = await moduleService.listModules(institutionId);
    res.json({ success: true, data: modules });
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const mod = await moduleService.getModuleById(req.params.id);
    res.json({ success: true, data: mod });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const institutionId = req.body.institutionId || req.user!.institutionId;
    const mod = await moduleService.createModule({
      ...req.body,
      institutionId,
    });

    await auditService.logAudit({
      userId: req.user!.id,
      action: 'module.created',
      resourceType: 'module',
      resourceId: mod.id,
      details: { title: mod.title },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: mod });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const mod = await moduleService.updateModule(req.params.id, req.body);

    await auditService.logAudit({
      userId: req.user!.id,
      action: 'module.updated',
      resourceType: 'module',
      resourceId: req.params.id,
      details: req.body,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: mod });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await moduleService.deleteModule(req.params.id);

    await auditService.logAudit({
      userId: req.user!.id,
      action: 'module.deleted',
      resourceType: 'module',
      resourceId: req.params.id,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { message: 'Module désactivé' } });
  } catch (err) {
    next(err);
  }
}
