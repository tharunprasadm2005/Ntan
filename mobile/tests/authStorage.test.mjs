import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCESS_KEY,
  REFRESH_KEY,
  SESSION_KEY,
  clearStoredAuth,
  readStoredAuth,
  writeSession,
  writeTokens,
} from '../src/authStorage.ts';

class MemoryStorage {
  values = new Map();

  async getItem(key) {
    return this.values.get(key) ?? null;
  }

  async setItem(key, value) {
    this.values.set(key, value);
  }

  async removeItem(key) {
    this.values.delete(key);
  }
}

const tokens = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  token_type: 'bearer',
  expires_in: 900,
};

const session = {
  user: { id: 'user-1', name: 'Amina Okafor', email: 'amina@example.com' },
  company: { id: 'company-1', name: 'Northline' },
  membership: { id: 'member-1', role: 'viewer' },
  permissions: ['inventory.read'],
};

test('restores persisted tokens and session', async () => {
  const storage = new MemoryStorage();
  await writeTokens(storage, tokens);
  await writeSession(storage, session);

  const stored = await readStoredAuth(storage);
  assert.equal(stored.accessToken, tokens.access_token);
  assert.equal(stored.refreshToken, tokens.refresh_token);
  assert.deepEqual(stored.session, session);
});

test('logout removes tokens and cached session', async () => {
  const storage = new MemoryStorage();
  await writeTokens(storage, tokens);
  await writeSession(storage, session);

  await clearStoredAuth(storage);

  assert.equal(storage.values.has(ACCESS_KEY), false);
  assert.equal(storage.values.has(REFRESH_KEY), false);
  assert.equal(storage.values.has(SESSION_KEY), false);
  const stored = await readStoredAuth(storage);
  assert.equal(stored.accessToken, null);
  assert.equal(stored.refreshToken, null);
  assert.equal(stored.session, null);
});

test('missing or corrupt session data is treated as signed out', async () => {
  const missing = await readStoredAuth(new MemoryStorage());
  assert.equal(missing.session, null);

  const corruptStorage = new MemoryStorage();
  await corruptStorage.setItem(SESSION_KEY, '{not-json');
  const corrupt = await readStoredAuth(corruptStorage);
  assert.equal(corrupt.session, null);

  const incompleteStorage = new MemoryStorage();
  await incompleteStorage.setItem(SESSION_KEY, JSON.stringify({ user: { id: 'user-1' } }));
  const incomplete = await readStoredAuth(incompleteStorage);
  assert.equal(incomplete.session, null);
});
