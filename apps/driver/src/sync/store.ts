// The offline queue on the phone: three SQLite tables. See engine.ts for how
// they are sent. The file survives the app being killed and the phone
// rebooting; nothing is ever dropped by itself.
//
//   ops         everything but points and heartbeat history, in order
//   points      location points; a point the server refused for good stays,
//               marked rejected with the answer, and is tried again later
//               (retryRejectedPoints: once a day, after an app update, on
//               pull to refresh)
//   heartbeats  the heartbeat history, one row a minute while on duty, kept
//               30 days at most on the phone

import * as SQLite from 'expo-sqlite';

import type { HeartbeatRow } from '../lib/api';
import type { Op, QueueStore, StoredHeartbeat, StoredOp, StoredPoint } from './engine';

export const HEARTBEAT_LOG_KEEP_DAYS = 30;

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
  CREATE TABLE IF NOT EXISTS heartbeats (
    seq  INTEGER PRIMARY KEY AUTOINCREMENT,
    at   TEXT NOT NULL UNIQUE,
    row  TEXT NOT NULL
  );
`);

// Columns added later (a database made by an earlier version has none of them).
const pointColumns = new Set(db.getAllSync<{ name: string }>('PRAGMA table_info(points)').map((c) => c.name));
if (!pointColumns.has('rejected')) {
  db.execSync(`
    ALTER TABLE points ADD COLUMN rejected INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE points ADD COLUMN reject_status INTEGER;
    ALTER TABLE points ADD COLUMN reject_error TEXT;
    ALTER TABLE points ADD COLUMN rejected_at TEXT;
  `);
}

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
      .getAllSync<PointRow>(
        'SELECT seq, session_id, recorded_at, lat, lng, accuracy_m, speed_mps, heading, battery_pct, is_mock FROM points WHERE rejected = 0 ORDER BY seq LIMIT ?',
        limit,
      )
      .map((row): StoredPoint => ({ ...row, is_mock: row.is_mock === 1 }));
  },
  removePoints(seqs) {
    if (seqs.length === 0) return;
    db.runSync(`DELETE FROM points WHERE seq IN (${seqs.map(() => '?').join(',')})`, seqs);
  },
  rejectPoints(seqs, status, error) {
    if (seqs.length === 0) return;
    db.runSync(
      `UPDATE points SET rejected = 1, reject_status = ?, reject_error = ?, rejected_at = ? WHERE seq IN (${seqs.map(() => '?').join(',')})`,
      status ?? null,
      error.slice(0, 300),
      new Date().toISOString(),
      ...seqs,
    );
  },
  nextHeartbeats(limit) {
    return db
      .getAllSync<{ seq: number; row: string }>('SELECT seq, row FROM heartbeats ORDER BY seq LIMIT ?', limit)
      .map((r): StoredHeartbeat => ({ seq: r.seq, row: JSON.parse(r.row) as HeartbeatRow }));
  },
  removeHeartbeats(seqs) {
    if (seqs.length === 0) return;
    db.runSync(`DELETE FROM heartbeats WHERE seq IN (${seqs.map(() => '?').join(',')})`, seqs);
  },
};

export function addOp(op: Op): void {
  db.runSync('INSERT INTO ops (op) VALUES (?)', JSON.stringify(op));
}

/** Adds an op of a kind of which only the newest matters (the driver_latest heartbeat): older waiting ones are dropped first. */
export function replaceOp(op: Op): void {
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM ops WHERE failed = 0 AND op LIKE ?", `{"kind":"${op.kind}"%`);
    db.runSync('INSERT INTO ops (op) VALUES (?)', JSON.stringify(op));
  });
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

/** Appends a heartbeat to the history (never replaced), and lets go of rows older than 30 days. */
export function addHeartbeatLog(row: HeartbeatRow): void {
  const keepFrom = new Date(Date.now() - HEARTBEAT_LOG_KEEP_DAYS * 86_400_000).toISOString();
  db.withTransactionSync(() => {
    db.runSync('INSERT OR IGNORE INTO heartbeats (at, row) VALUES (?, ?)', row.at, JSON.stringify(row));
    db.runSync('DELETE FROM heartbeats WHERE at < ?', keepFrom);
  });
}

export interface QueueCounts {
  /** Things waiting to be sent (not counting location points). */
  ops: number;
  /** Location points waiting to be sent. */
  points: number;
  /** Location points the server refused; kept, tried again later. */
  rejected: number;
  /** Heartbeat history rows waiting to be sent. */
  heartbeats: number;
  /** Things the server refused; kept so the driver and the office can see them. */
  failed: number;
}

export function queueCounts(): QueueCounts {
  const row = db.getFirstSync<QueueCounts>(
    `SELECT (SELECT COUNT(*) FROM ops WHERE failed = 0) AS ops,
            (SELECT COUNT(*) FROM points WHERE rejected = 0) AS points,
            (SELECT COUNT(*) FROM points WHERE rejected = 1) AS rejected,
            (SELECT COUNT(*) FROM heartbeats) AS heartbeats,
            (SELECT COUNT(*) FROM ops WHERE failed = 1) AS failed`,
  );
  return row ?? { ops: 0, points: 0, rejected: 0, heartbeats: 0, failed: 0 };
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

/** The refused points' answers, newest first (for the Me screen and for support). */
export function rejectedErrors(limit = 5): { status: number | null; error: string | null; at: string | null; count: number }[] {
  return db.getAllSync<{ status: number | null; error: string | null; at: string | null; count: number }>(
    `SELECT reject_status AS status, reject_error AS error, MAX(rejected_at) AS at, COUNT(*) AS count
     FROM points WHERE rejected = 1 GROUP BY reject_status, reject_error ORDER BY at DESC LIMIT ?`,
    limit,
  );
}

/** Puts refused items back in line (for "Try those again"). */
export function retryFailed(): void {
  db.runSync('UPDATE ops SET failed = 0, error = NULL WHERE failed = 1');
}

/** Puts the refused points back in line. Returns how many. */
export function retryRejectedPoints(): number {
  return db.runSync('UPDATE points SET rejected = 0, reject_status = NULL, reject_error = NULL, rejected_at = NULL WHERE rejected = 1').changes;
}

export function clearQueue(): void {
  db.execSync('DELETE FROM ops; DELETE FROM points; DELETE FROM heartbeats;');
}
