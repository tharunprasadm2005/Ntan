import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { api, ApiError } from './api';
import {
  clearStoredAuth,
  readStoredAuth,
  writeSession,
  writeTokens,
  type AuthStorage,
} from './authStorage';
import type { AcceptInvitationInput, AuthResponse, Session } from './types';

interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function webStorage(): WebStorage | undefined {
  return (globalThis as unknown as { localStorage?: WebStorage }).localStorage;
}

const deviceStorage: AuthStorage = {
  async getItem(key) {
    if (Platform.OS === 'web') {
      return webStorage()?.getItem(key) ?? null;
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key, value) {
    if (Platform.OS === 'web') {
      webStorage()?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key) {
    if (Platform.OS === 'web') {
      webStorage()?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; session: Session };

interface AuthContextValue {
  state: AuthState;
  login(email: string, password: string): Promise<void>;
  registerCompany(input: {
    company_name: string;
    name: string;
    email: string;
    password: string;
    phone?: string;
    warehouse_name?: string;
    warehouse_code?: string;
    warehouse_address?: string;
    warehouse_type?: string;
    warehouse_layout?: string;
    warehouse_category?: string;
    location_code?: string;
  }): Promise<void>;
  joinCompany(input: AcceptInvitationInput): Promise<void>;
  logout(): Promise<void>;
  refreshSession(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const clearSession = useCallback(async () => {
    api.setTokens(null, null);
    try {
      await clearStoredAuth(deviceStorage);
    } finally {
      setState({ status: 'signedOut' });
    }
  }, []);

  useEffect(() => {
    api.onTokens = (tokens) => {
      void writeTokens(deviceStorage, tokens);
    };
    api.onAuthFailure = () => {
      void clearSession();
    };

    let active = true;
    const bootstrap = async () => {
      const stored = await readStoredAuth(deviceStorage);
      if (!active) {
        return;
      }
      if (!stored.accessToken || !stored.refreshToken) {
        setState({ status: 'signedOut' });
        return;
      }
      api.setTokens(stored.accessToken, stored.refreshToken);
      try {
        const session = await api.session();
        if (!active) {
          return;
        }
        await writeSession(deviceStorage, session);
        setState({ status: 'signedIn', session });
      } catch (error) {
        if (!active) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          await clearSession();
          return;
        }
        if (stored.session) {
          setState({ status: 'signedIn', session: stored.session });
          return;
        }
        setState({ status: 'signedOut' });
      }
    };
    void bootstrap();

    return () => {
      active = false;
      api.onTokens = null;
      api.onAuthFailure = null;
    };
  }, [clearSession]);

  const completeAuth = useCallback(async (response: AuthResponse) => {
    api.setTokens(response.access_token, response.refresh_token);
    await writeTokens(deviceStorage, response);
    const session = await api.session();
    await writeSession(deviceStorage, session);
    setState({ status: 'signedIn', session });
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await api.login(email.trim().toLowerCase(), password);
      await completeAuth(response);
    },
    [completeAuth],
  );

  const registerCompany = useCallback(
    async (input: {
      company_name: string;
      name: string;
      email: string;
      password: string;
      phone?: string;
      warehouse_name?: string;
      warehouse_code?: string;
      warehouse_address?: string;
      warehouse_type?: string;
      warehouse_layout?: string;
      warehouse_category?: string;
      location_code?: string;
    }) => {
      const response = await api.registerCompany({
        ...input,
        email: input.email.trim().toLowerCase(),
      });
      await completeAuth(response);
    },
    [completeAuth],
  );

  const joinCompany = useCallback(
    async (input: AcceptInvitationInput) => {
      const response = await api.acceptInvitation({
        ...input,
        invitation_token: input.invitation_token.trim(),
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
      });
      await completeAuth(response);
    },
    [completeAuth],
  );

  const logout = useCallback(async () => {
    const refreshToken = api.refreshToken;
    await clearSession();
    if (refreshToken) {
      try {
        await api.logout(refreshToken);
      } catch {
      }
    }
  }, [clearSession]);

  const refreshSession = useCallback(async () => {
    const session = await api.session();
    await writeSession(deviceStorage, session);
    setState({ status: 'signedIn', session });
  }, []);

  const value = useMemo(
    () => ({ state, login, registerCompany, joinCompany, logout, refreshSession }),
    [state, login, registerCompany, joinCompany, logout, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
