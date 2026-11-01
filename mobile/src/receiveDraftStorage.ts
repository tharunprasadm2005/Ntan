import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import type { DraftPersistence } from './receiveDraftStore';

/**
 * Device-local draft storage. Native builds reuse the existing offline SQLite
 * database; web falls back to localStorage. Every operation is best-effort:
 * receiving must keep working when device storage is unavailable.
 */
const DATABASE_NAME = 'ntan-offline.db';
const TABLE = 'receive_drafts';
const WEB_PREFIX = 'ntan.receive_draft.';

let connection: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase | null> | null = null;
const memory = new Map<string, string>();

function webStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function isWeb(): boolean {
  return Platform.OS === 'web';
}

async function getConnection(): Promise<SQLite.SQLiteDatabase | null> {
  if (isWeb()) {
    return null;
  }
  if (connection) {
    return connection;
  }
  if (!opening) {
    opening = SQLite.openDatabaseAsync(DATABASE_NAME)
      .then(async (database) => {
        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS ${TABLE} (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        connection = database;
        return database;
      })
      .catch(() => null)
      .finally(() => {
        opening = null;
      });
  }
  return opening;
}

export const receiveDraftStorage: DraftPersistence = {
  async getItem(key: string): Promise<string | null> {
    const store = webStorage();
    if (store) {
      try {
        return store.getItem(`${WEB_PREFIX}${key}`);
      } catch {
        return memory.get(key) ?? null;
      }
    }
    const database = await getConnection();
    if (!database) {
      return memory.get(key) ?? null;
    }
    try {
      const row = await database.getFirstAsync<{ value: string }>(
        `SELECT value FROM ${TABLE} WHERE key = ?`,
        key,
      );
      return row?.value ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    memory.set(key, value);
    const store = webStorage();
    if (store) {
      try {
        store.setItem(`${WEB_PREFIX}${key}`, value);
        return;
      } catch {
        return;
      }
    }
    const database = await getConnection();
    if (!database) {
      return;
    }
    try {
      await database.runAsync(
        `INSERT INTO ${TABLE} (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        key,
        value,
        new Date().toISOString(),
      );
    } catch {
      // Memory copy above keeps the draft available for this session.
    }
  },

  async removeItem(key: string): Promise<void> {
    memory.delete(key);
    const store = webStorage();
    if (store) {
      try {
        store.removeItem(`${WEB_PREFIX}${key}`);
        return;
      } catch {
        return;
      }
    }
    const database = await getConnection();
    if (!database) {
      return;
    }
    try {
      await database.runAsync(`DELETE FROM ${TABLE} WHERE key = ?`, key);
    } catch {
      // Ignore; the stale record expires by age on read.
    }
  },
};
