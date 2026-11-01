import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

export type OutboxStatus =
  | 'draft'
  | 'queued'
  | 'syncing'
  | 'applied'
  | 'conflict'
  | 'rejected';

export interface OutboxEntry {
  id: string;
  operation_id: string;
  type: string;
  client_id: string | null;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

interface OutboxRow {
  id: string;
  operation_id: string;
  type: string;
  client_id: string | null;
  payload: string;
  status: OutboxStatus;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase | null> | null = null;

function supported(): boolean {
  return Platform.OS !== 'web';
}

async function getDatabase(): Promise<SQLite.SQLiteDatabase | null> {
  if (!supported()) {
    return null;
  }
  if (database) {
    return database;
  }
  if (!opening) {
    opening = SQLite.openDatabaseAsync('ntan-offline.db')
      .then((connection) => {
        database = connection;
        return connection;
      })
      .finally(() => {
        opening = null;
      });
  }
  return opening;
}

function parseRow(row: OutboxRow): OutboxEntry {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { ...row, payload };
}

export async function initializeOffline(): Promise<boolean> {
  const connection = await getDatabase();
  if (!connection) {
    return false;
  }
  await connection.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY NOT NULL,
      operation_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      client_id TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS outbox_status_created
      ON outbox (status, created_at);
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  return true;
}

export async function queueOperation(input: {
  type: string;
  clientId?: string | null;
  payload: Record<string, unknown>;
  operationId?: string;
}): Promise<OutboxEntry | null> {
  const connection = await getDatabase();
  if (!connection) {
    return null;
  }
  const now = new Date().toISOString();
  const operationId = input.operationId ?? Crypto.randomUUID();
  const entry: OutboxEntry = {
    id: Crypto.randomUUID(),
    operation_id: operationId,
    type: input.type,
    client_id: input.clientId ?? null,
    payload: input.payload,
    status: 'queued',
    error_code: null,
    error_message: null,
    attempts: 0,
    created_at: now,
    updated_at: now,
  };
  await connection.runAsync(
    `INSERT INTO outbox (
      id, operation_id, type, client_id, payload, status,
      error_code, error_message, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.id,
    entry.operation_id,
    entry.type,
    entry.client_id,
    JSON.stringify(entry.payload),
    entry.status,
    entry.error_code,
    entry.error_message,
    entry.attempts,
    entry.created_at,
    entry.updated_at,
  );
  return entry;
}

export async function listOutbox(status?: OutboxStatus): Promise<OutboxEntry[]> {
  const connection = await getDatabase();
  if (!connection) {
    return [];
  }
  const rows = status
    ? await connection.getAllAsync<OutboxRow>(
        'SELECT * FROM outbox WHERE status = ? ORDER BY created_at ASC',
        status,
      )
    : await connection.getAllAsync<OutboxRow>(
        'SELECT * FROM outbox ORDER BY created_at ASC',
      );
  return rows.map(parseRow);
}

export async function countPendingOperations(): Promise<number> {
  const connection = await getDatabase();
  if (!connection) {
    return 0;
  }
  const row = await connection.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM outbox WHERE status IN ('draft', 'queued', 'syncing', 'conflict')`,
  );
  return row?.count ?? 0;
}

export async function updateOutboxStatus(
  id: string,
  status: OutboxStatus,
  error?: { code?: string | null; message?: string | null },
): Promise<void> {
  const connection = await getDatabase();
  if (!connection) {
    return;
  }
  const increment = status === 'syncing' ? 1 : 0;
  await connection.runAsync(
    `UPDATE outbox
     SET status = ?, error_code = ?, error_message = ?, attempts = attempts + ?,
         updated_at = ?
     WHERE id = ?`,
    status,
    error?.code ?? null,
    error?.message ?? null,
    increment,
    new Date().toISOString(),
    id,
  );
}

export async function getSyncCursor(): Promise<number> {
  const connection = await getDatabase();
  if (!connection) {
    return 0;
  }
  const row = await connection.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = 'cursor'",
  );
  const parsed = row ? Number(row.value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function setSyncCursor(cursor: number): Promise<void> {
  const connection = await getDatabase();
  if (!connection) {
    return;
  }
  await connection.runAsync(
    `INSERT INTO sync_state (key, value) VALUES ('cursor', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    String(cursor),
  );
}
