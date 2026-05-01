// ================================================================
// API CLIENT — Frontend service for all backend API calls
// Handles JWT authentication, auto-refresh on 401, typed responses
// ================================================================

const API_BASE = 'http://localhost:3001/api';

// ─── Token Management ─── 
// Tokens stored in memory (not localStorage) to prevent XSS access
let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
}

export function getAccessToken() {
  return accessToken;
}

// ─── Base Fetch Wrapper ───

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errors?: Record<string, string>;
}

async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  // Auto-refresh on 401
  if (response.status === 401 && refreshToken) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${accessToken}`;
      response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });
    }
  }

  const data = await response.json();
  return data as ApiResponse<T>;
}

async function tryRefreshToken(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      clearTokens();
      return false;
    }

    const data = await res.json();
    if (data.success && data.data) {
      setTokens(data.data.accessToken, data.data.refreshToken);
      return true;
    }

    clearTokens();
    return false;
  } catch {
    clearTokens();
    return false;
  }
}

// ─── Auth API ───

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'student' | 'verifier';
  institutionId: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export async function loginApi(email: string, password: string) {
  const res = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (res.success && res.data) {
    setTokens(res.data.accessToken, res.data.refreshToken);
  }
  return res;
}

export async function logoutApi() {
  const res = await apiFetch('/auth/logout', { method: 'POST' });
  clearTokens();
  return res;
}

export async function getProfileApi() {
  return apiFetch<any>('/auth/profile');
}

// ─── Users API ───

export async function listUsersApi(filters?: { role?: string }) {
  const params = filters?.role ? `?role=${filters.role}` : '';
  return apiFetch<any[]>(`/users${params}`);
}

export async function createUserApi(data: {
  email: string;
  fullName: string;
  role: string;
  institutionId?: string;
}) {
  return apiFetch<any>('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateUserApi(id: string, data: Record<string, unknown>) {
  return apiFetch<any>(`/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteUserApi(id: string) {
  return apiFetch<any>(`/users/${id}`, { method: 'DELETE' });
}

export async function toggleModuleApi(userId: string, moduleId: string) {
  return apiFetch<any>(`/users/${userId}/modules`, {
    method: 'POST',
    body: JSON.stringify({ moduleId }),
  });
}

// ─── Modules API ───

export async function listModulesApi() {
  return apiFetch<any[]>('/modules');
}

export async function createModuleApi(data: {
  title: string;
  description?: string;
  institutionId?: string;
}) {
  return apiFetch<any>('/modules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateModuleApi(id: string, data: Record<string, unknown>) {
  return apiFetch<any>(`/modules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteModuleApi(id: string) {
  return apiFetch<any>(`/modules/${id}`, { method: 'DELETE' });
}

// ─── Certificates API ───

export async function listCertificatesApi(filters?: { studentId?: string }) {
  const params = filters?.studentId ? `?studentId=${filters.studentId}` : '';
  return apiFetch<any[]>(`/certificates${params}`);
}

export async function getCertificateApi(id: string) {
  return apiFetch<any>(`/certificates/${id}`);
}

export async function issueCertificateApi(data: {
  studentId: string;
  title: string;
  institutionId?: string;
}) {
  return apiFetch<any>('/certificates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function revokeCertificateApi(id: string, reason: string) {
  return apiFetch<any>(`/certificates/${id}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ─── Public Verification API (no auth) ───

export interface VerifyResult {
  valid: boolean;
  result: 'valid' | 'invalid' | 'revoked' | 'expired' | 'not_found';
  certificate?: any;
  details?: Record<string, unknown>;
}

export async function verifyCertificateApi(uid: string, qrSig?: string) {
  const params = qrSig ? `?sig=${qrSig}` : '';
  // No auth needed for verification
  const res = await fetch(`${API_BASE}/verify/${uid.toUpperCase()}${params}`);
  return (await res.json()) as ApiResponse<VerifyResult>;
}
