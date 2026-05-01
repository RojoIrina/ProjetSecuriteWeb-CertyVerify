// ================================================================
// AUTH CONTROLLER — Handles login, refresh, logout, profile
// ================================================================
import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service.js';
import * as auditService from '../services/audit.service.js';

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);

    await auditService.logAudit({
      userId: result.user.id,
      action: 'user.login',
      resourceType: 'user',
      resourceId: result.user.id,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        user: result.user,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body;
    const tokens = await authService.refreshAccessToken(refreshToken);

    res.json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.logout(req.user!.id);

    await auditService.logAudit({
      userId: req.user!.id,
      action: 'user.logout',
      resourceType: 'user',
      resourceId: req.user!.id,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { message: 'Déconnexion réussie' } });
  } catch (err) {
    next(err);
  }
}

export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const profile = await authService.getUserProfile(req.user!.id);
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
}
