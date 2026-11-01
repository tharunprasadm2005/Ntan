import type { Session, TokenPair } from './types';

export const ACCESS_KEY = 'ntan.access_token';
export const REFRESH_KEY = 'ntan.refresh_token';
export const SESSION_KEY = 'ntan.session';

export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface StoredAuth {
  accessToken: string | null;
  refreshToken: string | null;
  session: Session | null;
}

function parseSession(value: string | null): Session | null {
  if (!value) {
    return null;
  }
  try {
    const session = JSON.parse(value) as Session;
    if (!session?.user?.id || !session?.company?.id || !session?.membership?.id) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function readStoredAuth(storage: AuthStorage): Promise<StoredAuth> {
  const [accessToken, refreshToken, cachedSession] = await Promise.all([
    storage.getItem(ACCESS_KEY),
    storage.getItem(REFRESH_KEY),
    storage.getItem(SESSION_KEY),
  ]);
  return {
    accessToken,
    refreshToken,
    session: parseSession(cachedSession),
  };
}

export async function writeTokens(storage: AuthStorage, tokens: TokenPair): Promise<void> {
  await Promise.all([
    storage.setItem(ACCESS_KEY, tokens.access_token),
    storage.setItem(REFRESH_KEY, tokens.refresh_token),
  ]);
}

export async function writeSession(storage: AuthStorage, session: Session): Promise<void> {
  await storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearStoredAuth(storage: AuthStorage): Promise<void> {
  await Promise.all([
    storage.removeItem(ACCESS_KEY),
    storage.removeItem(REFRESH_KEY),
    storage.removeItem(SESSION_KEY),
  ]);
}
