// The offline queue on the phone: two SQLite tables. See engine.ts for how
// they are sent.

import * as SQLite from 'expo-sqlite';

import type { Op, QueueStore, StoredOp, StoredPoint } from './engine';

const db = SQLite.openDatabaseSync('fame-driver-queue.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS ops (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    op      TEXT NOT NULL,
    failed  INTEGER NOT NULL DEFAULT 0,
    error   TEXT
  );
  CREATE TABLE IF NOT EXISTS points (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    recorded_at TEXT NOT NULL UNIQUE,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    accuracy_m  REAL,
    speed_mps   REAL,
    heading     REAL,
    battery_pct INTEGER,
    is_mock     INTEGER NOT NULL DEFAULT 0
  );
`);

interface OpRow {
  seq: number;
  op: string;
  error: string | null;
}

interface PointRow extends Omit<StoredPoint, 'is_mock'> {
  is_mock: number;
}

export const queueStore: QueueStore = {
  nextOps(limit) {
    return db
      .getAllSync<OpRow>('SELECT seq, op, error FROM ops WHERE failed = 0 ORDER BY seq LIMIT ?', limit)
      .map((row): StoredOp => ({ seq: row.seq, op: JSON.parse(row.op) as Op }));
  },
  removeOp(seq) {
    db.runSync('DELETE FROM ops WHERE seq = ?', seq);
  },
  failOp(seq, error) {
    db.runSync('UPDATE ops SET failed = 1, error = ? WHERE seq = ?', error, seq);
  },
  nextPoints(limit) {
    return db
      .getAllSync<PointRow>('SELECT * FROM points ORDER BY seq LIMIT ?', limit)
      .map((row): StoredPoint => ({ ...row, is_mock: row.is_mock === 1 }));
  },
  removePoints(seqs) {
    if (seqs.length === 0) return;
    db.runSync(`DELETE FROM points WHERE seq IN (${seqs.map(() => '?').join(',')})`, seqs);
  },
};

export function addOp(op: Op): void {
  db.runSync('INSERT INTO ops (op) VALUES (?)', JSON.stringify(op));
}

/** Adds location points. A point with a time that is already stored is ignored. */
export function addPoints(points: Omit<StoredPoint, 'seq'>[]): void {
  db.withTransactionSync(() => {
    for (const p of points) {
      db.runSync(
        `INSERT OR IGNORE INTO points (session_id, recorded_at, lat, lng, accuracy_m, speed_mps, heading, battery_pct, is_mock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.session_id, p.recorded_at, p.lat, p.lng, p.accuracy_m, p.speed_mps, p.heading, p.battery_pct, p.is_mock ? 1 : 0,
      );
    }
  });
}

export interface QueueCounts {
  /** Things waiting to be sent (not counting location points). */
  ops: number;
  points: number;
  /** Things the server refused; kept so the driver and the office can see them. */
  failed: number;
}

export function queueCounts(): QueueCounts {
  const row = db.getFirstSync<QueueCounts>(
    `SELECT (SELECT COUNT(*) FROM ops WHERE failed = 0) AS ops,
            (SELECT COUNT(*) FROM points) AS points,
            (SELECT COUNT(*) FROM ops WHERE failed = 1) AS failed`,
  );
  return row ?? { ops: 0, points: 0, failed: 0 };
}

/** Ids of tasks that have a change waiting to be sent. */
export function tasksWaiting(): Set<string> {
  const ids = new Set<string>();
  for (const { op } of queueStore.nextOps(500)) {
    if (op.kind === 'task_patch' && op.patch.status !== undefined) ids.add(op.id);
  }
  return ids;
}

export function failedErrors(): string[] {
  return db.getAllSync<{ error: string | null }>('SELECT error FROM ops WHERE failed = 1 ORDER BY seq').map((r) => r.error ?? '');
}

/** Puts refused items back in line (for "Try those again"). */
export function retryFailed(): void {
  db.runSync('UPDATE ops SET failed = 0, error = NULL WHERE failed = 1');
}

export function clearQueue(): void {
  db.execSync('DELETE FROM ops; DELETE FROM points;');
}
