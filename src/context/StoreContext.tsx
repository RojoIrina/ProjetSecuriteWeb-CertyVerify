// ================================================================
// STORE CONTEXT — Migrated from localStorage to API backend
// All state now comes from the CertiVerify Express API
// ================================================================
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  loginApi, logoutApi, getProfileApi,
  listUsersApi, createUserApi, deleteUserApi,
  listModulesApi, createModuleApi, deleteModuleApi,
  listCertificatesApi, issueCertificateApi,
  toggleModuleApi, verifyCertificateApi,
  setTokens, clearTokens, getAccessToken,
  type AuthUser, type VerifyResult,
} from '../services/api';

// ─── Types ───

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: 'admin' | 'student' | 'verifier';
  isActive: boolean;
  institutionId: string | null;
  institution?: { id: string; name: string } | null;
  userModules?: { moduleId: string; status: string; completedAt: string | null; module: { id: string; title: string } }[];
  completedModules?: string[];
}

export interface Module {
  id: string;
  title: string;
  description: string | null;
  creditHours: number;
  isActive: boolean;
}

export interface Certificate {
  id: string;
  certificateUid: string;
  studentId: string;
  studentName: string;
  title: string;
  documentHash: string;
  issuedAt: string;
  revokedAt: string | null;
  qrPayload?: string;
  student?: { id: string; fullName: string; email: string };
  institution?: { id: string; name: string };
}

interface StoreContextType {
  // State
  users: User[];
  modules: Module[];
  certificates: Certificate[];
  currentUser: (User & { role: string }) | null;
  isLoading: boolean;
  error: string | null;

  // Auth
  login: (email: string, password: string) => Promise<User | null>;
  logout: () => void;

  // Users (admin)
  refreshUsers: () => Promise<void>;
  addUser: (data: { email: string; fullName: string; role: string }) => Promise<{ user: User; temporaryPassword: string } | null>;
  removeUser: (id: string) => Promise<void>;

  // Modules
  refreshModules: () => Promise<void>;
  addModule: (data: { title: string; description: string }) => Promise<Module | null>;
  removeModule: (id: string) => Promise<void>;

  // Certificates
  refreshCertificates: () => Promise<void>;
  issueCertificate: (student: User) => Promise<Certificate | null>;
  verifyCertificate: (uid: string, qrSig?: string) => Promise<VerifyResult | null>;

  // Student
  toggleModuleCompletion: (userId: string, moduleId: string) => Promise<void>;

  // Legacy compatibility
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setModules: React.Dispatch<React.SetStateAction<Module[]>>;
  setCurrentUser: (user: any | null) => void;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider = ({ children }: { children: ReactNode }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Bootstrap: check for saved session ───
  useEffect(() => {
    const savedToken = sessionStorage.getItem('cv_access_token');
    const savedRefresh = sessionStorage.getItem('cv_refresh_token');
    if (savedToken && savedRefresh) {
      setTokens(savedToken, savedRefresh);
      // Fetch profile to restore session
      getProfileApi().then(res => {
        if (res.success && res.data) {
          setCurrentUser(res.data as User);
        } else {
          clearTokens();
          sessionStorage.removeItem('cv_access_token');
          sessionStorage.removeItem('cv_refresh_token');
        }
      });
    }
  }, []);

  // ─── Load data when user is authenticated ───
  useEffect(() => {
    if (currentUser) {
      refreshModules();
      refreshCertificates();
      if (currentUser.role === 'admin') {
        refreshUsers();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // ─── Auth ───

  const login = async (email: string, password: string): Promise<User | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await loginApi(email, password);
      if (res.success && res.data) {
        // Save tokens for session persistence
        sessionStorage.setItem('cv_access_token', res.data.accessToken);
        sessionStorage.setItem('cv_refresh_token', res.data.refreshToken);

        // Fetch full profile
        const profileRes = await getProfileApi();
        if (profileRes.success && profileRes.data) {
          const user = profileRes.data as User;
          setCurrentUser(user);
          return user;
        }
      }
      if (res.error) setError(res.error);
      return null;
    } catch {
      setError('Erreur de connexion au serveur');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    logoutApi().catch(() => {}); // Fire and forget
    clearTokens();
    sessionStorage.removeItem('cv_access_token');
    sessionStorage.removeItem('cv_refresh_token');
    setCurrentUser(null);
    setUsers([]);
    setCertificates([]);
  };

  // ─── Users ───

  const refreshUsers = useCallback(async () => {
    const res = await listUsersApi();
    if (res.success && res.data) {
      setUsers(res.data.map(mapUser));
    }
  }, []);

  const addUser = async (data: { email: string; fullName: string; role: string }) => {
    const res = await createUserApi({ ...data, role: data.role });
    if (res.success && res.data) {
      refreshUsers();
      return res.data as { user: User; temporaryPassword: string };
    }
    return null;
  };

  const removeUser = async (id: string) => {
    await deleteUserApi(id);
    refreshUsers();
  };

  // ─── Modules ───

  const refreshModules = useCallback(async () => {
    const res = await listModulesApi();
    if (res.success && res.data) {
      setModules(res.data as Module[]);
    }
  }, []);

  const addModule = async (data: { title: string; description: string }) => {
    const res = await createModuleApi(data);
    if (res.success && res.data) {
      refreshModules();
      return res.data as Module;
    }
    return null;
  };

  const removeModule = async (id: string) => {
    await deleteModuleApi(id);
    refreshModules();
  };

  // ─── Certificates ───

  const refreshCertificates = useCallback(async () => {
    const res = await listCertificatesApi(
      currentUser?.role === 'student' ? { studentId: currentUser.id } : undefined
    );
    if (res.success && res.data) {
      setCertificates(res.data as Certificate[]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role]);

  const issueCert = async (student: User): Promise<Certificate | null> => {
    const res = await issueCertificateApi({
      studentId: student.id,
      title: 'Architecture & Sécurité des Systèmes Numériques',
    });
    if (res.success && res.data) {
      refreshCertificates();
      return res.data as Certificate;
    }
    return null;
  };

  const verifyCert = async (uid: string, qrSig?: string): Promise<VerifyResult | null> => {
    const res = await verifyCertificateApi(uid, qrSig);
    if (res.success && res.data) {
      return res.data;
    }
    return null;
  };

  // ─── Student Module Toggle ───

  const toggleModuleCompletion = async (userId: string, moduleId: string) => {
    await toggleModuleApi(userId, moduleId);
    // Refresh user profile to get updated completedModules
    const profileRes = await getProfileApi();
    if (profileRes.success && profileRes.data) {
      setCurrentUser(profileRes.data as User);
    }
    if (currentUser?.role === 'admin') refreshUsers();
  };

  return (
    <StoreContext.Provider value={{
      users, modules, certificates, currentUser: currentUser as any, isLoading, error,
      login, logout,
      refreshUsers, addUser, removeUser,
      refreshModules, addModule, removeModule,
      refreshCertificates, issueCertificate: issueCert, verifyCertificate: verifyCert,
      toggleModuleCompletion,
      setUsers, setModules, setCurrentUser,
    }}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used within StoreProvider');
  return context;
};

// ─── Helpers ───

function mapUser(u: any): User {
  return {
    ...u,
    completedModules: u.userModules
      ?.filter((um: any) => um.status === 'completed')
      .map((um: any) => um.moduleId) ?? [],
  };
}
