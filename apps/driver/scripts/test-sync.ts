// Tests of the offline queue's engine (src/sync/engine.ts) with a fake server:
// batch order and size, the backoff after a failed connection, points the
// server refuses (kept, marked, tried again), the heartbeat history after the
// points, and ops blocking points. Pure code, no stack needed:
//
//   npm run test:sync          (from apps/driver)

import * as realApi from '../src/lib/api';
import { ApiError, type HeartbeatRow } from '../src/lib/api';
import {
  BACKOFF_MS,
  createSync,
  HEARTBEAT_BATCH,
  type Op,
  POINT_BATCH,
  type QueueStore,
  type StoredHeartbeat,
  type StoredOp,
  type StoredPoint,
} from '../src/sync/engine';

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

/** The queue in memory, with the rejected marks the phone's SQLite keeps. */
function memoryStore() {
  let seq = 0;
  const ops: (StoredOp & { failed?: string })[] = [];
  const points: StoredPoint[] = [];
  const rejected = new Map<number, { status: number | undefined; error: string }>();
  const heartbeats: StoredHeartbeat[] = [];
  const store: QueueStore = {
    nextOps: (limit) => ops.filter((item) => item.failed === undefined).slice(0, limit),
    removeOp: (id) => void ops.splice(ops.findIndex((item) => item.seq === id), 1),
    failOp: (id, error) => {
      const found = ops.find((item) => item.seq === id);
      if (found) found.failed = error;
    },
    nextPoints: (limit) => points.filter((p) => !rejected.has(p.seq)).slice(0, limit),
    removePoints: (seqs) => {
      for (const id of seqs) points.splice(points.findIndex((p) => p.seq === id), 1);
    },
    rejectPoints: (seqs, status, error) => seqs.forEach((id) => rejected.set(id, { status, error })),
    nextHeartbeats: (limit) => heartbeats.slice(0, limit),
    removeHeartbeats: (seqs) => {
      for (const id of seqs) heartbeats.splice(heartbeats.findIndex((h) => h.seq === id), 1);
    },
  };
  return {
    store,
    add: (...list: Op[]) => list.forEach((op) => ops.push({ seq: ++seq, op })),
    addPoints: (n: number, from = 0) => {
      for (let i = 0; i < n; i++) {
        points.push({
          seq: ++seq,
          session_id: 's1',
          recorded_at: new Date(Date.parse('2026-10-14T03:00:00Z') + (from + i) * 5000).toISOString(),
          lat: 6.9,
          lng: 79.9,
          accuracy_m: 8,
          speed_mps: 10,
          heading: 90,
          battery_pct: 80,
          is_mock: false,
        });
      }
    },
    addHeartbeats: (n: number) => {
      for (let i = 0; i < n; i++) heartbeats.push({ seq: ++seq, row: { at: new Date(i * 60000).toISOString(), sharing: true, location_on: true, permission: 'always', battery_pct: 80, app_version: 't', queued_points: 0 } });
    },
    waiting: () => points.filter((p) => !rejected.has(p.seq)).length,
    rejected: () => [...rejected.values()],
    retryRejected: () => rejected.clear(),
    heartbeats: () => heartbeats.length,
    ops: () => ops.filter((item) => item.failed === undefined).length,
  };
}

interface Call {
  what: string;
  n: number;
  first?: string;
  last?: string;
}

/** A fake server: records the calls, fails the way it is told. */
function fakeServer() {
  const calls: Call[] = [];
  let mode: 'ok' | 'network' | 'refuse' = 'ok';
  let failAfterCalls = Infinity;
  let failTimes = Infinity;
  const fail = () => {
    if (failTimes <= 0) return;
    failTimes -= 1;
    if (mode === 'network') throw new ApiError('location: Network request failed', false);
    if (mode === 'refuse') throw new ApiError('location: violates check constraint', true, '23514', 400);
  };
  const api = {
    ...realApi,
    insertPoints: async (_client: unknown, rows: realApi.PointInsert[]) => {
      calls.push({ what: 'points', n: rows.length, first: rows[0]?.recorded_at, last: rows[rows.length - 1]?.recorded_at });
      if (calls.length > failAfterCalls) fail();
    },
    insertClosedSession: async () => {
      calls.push({ what: 'closed_session', n: 1 });
    },
    insertHeartbeats: async (_client: unknown, _id: string, rows: HeartbeatRow[]) => {
      calls.push({ what: 'heartbeats', n: rows.length });
      if (calls.length > failAfterCalls) fail();
    },
    sendHeartbeat: async () => {
      calls.push({ what: 'heartbeat', n: 1 });
      if (calls.length > failAfterCalls) fail();
    },
    patchEmployee: async () => {
      calls.push({ what: 'employee', n: 1 });
      if (calls.length > failAfterCalls) fail();
    },
  } as unknown as typeof realApi;
  return {
    api,
    calls,
    set: (m: typeof mode, after = 0, times = Infinity) => {
      mode = m;
      failAfterCalls = after;
      failTimes = times;
    },
  };
}

async function main() {
  const clock = { now: 1_000_000 };
  const makeSync = (q: ReturnType<typeof memoryStore>, s: ReturnType<typeof fakeServer>) =>
    createSync({
      client: {} as realApi.Client,
      store: q.store,
      employeeId: () => 'e1',
      uploadFile: async () => undefined,
      removeFile: () => undefined,
      api: s.api,
      now: () => clock.now,
    });

  // --- 1. batches of 500, oldest first, until empty ------------------------------
  {
    const q = memoryStore();
    const s = fakeServer();
    const sync = makeSync(q, s);
    q.addPoints(1200);
    const r = await sync.flush();
    check(r.sent === 1200 && !r.offline && q.waiting() === 0, '1200 points are sent and removed', r);
    check(s.calls.map((c) => c.n).join(',') === `${POINT_BATCH},${POINT_BATCH},200`, 'in batches of 500, 500, 200', s.calls.map((c) => c.n));
    check(s.calls[0].first! < s.calls[0].last! && s.calls[0].last! < s.calls[1].first!, 'oldest first, batch after batch', s.calls.map((c) => [c.first, c.last]));
  }

  // --- 2. a failed connection keeps everything and waits 5 s, 30 s, 2 min, 5 min, 5 min ------
  {
    const q = memoryStore();
    const s = fakeServer();
    const sync = makeSync(q, s);
    q.addPoints(1200);
    s.set('network', 1); // the second batch fails
    let r = await sync.flush();
    check(r.offline && r.sent === 500 && q.waiting() === 700, 'the connection drops on batch 2: 500 sent, 700 kept', { r, waiting: q.waiting() });
    check(sync.backoff().nextTryAt === clock.now + BACKOFF_MS[0], 'the next attempt waits 5 s', sync.backoff());
    r = await sync.flush();
    check(r.skipped && s.calls.length === 2, 'an attempt inside the wait does nothing', { r, calls: s.calls.length });
    r = await sync.flush({ force: true });
    check(!r.skipped && s.calls.length === 3 && r.offline, 'a forced attempt tries anyway (and fails again)', { r, calls: s.calls.length });
    const waits: number[] = [sync.backoff().nextTryAt - clock.now];
    for (let i = 0; i < 4; i++) {
      clock.now = sync.backoff().nextTryAt;
      await sync.flush();
      waits.push(sync.backoff().nextTryAt - clock.now);
    }
    check(waits.join(',') === '30000,120000,300000,300000,300000', 'then 30 s, 2 min, 5 min, 5 min, 5 min', waits);
    s.set('ok');
    clock.now = sync.backoff().nextTryAt;
    r = await sync.flush();
    check(!r.offline && q.waiting() === 0 && sync.backoff().failures === 0, 'the connection is back: the rest goes and the ladder resets', { r, backoff: sync.backoff() });
    check(s.calls.filter((c) => c.what === 'points').every((c) => c.n <= POINT_BATCH), 'never more than 500 in a batch');
  }

  // --- 3. refused points are kept, marked with the answer, and tried again on request ----
  {
    const q = memoryStore();
    const s = fakeServer();
    const sync = makeSync(q, s);
    q.addPoints(700);
    s.set('refuse', 0, 2); // the server refuses the first batch (and its second try after the rescue)
    let r = await sync.flush();
    const refusedCall = s.calls.filter((c) => c.what === 'points').length;
    check(r.rejected === 500 && q.rejected().length === 500, 'a refused batch is marked rejected, not dropped', { r, rejected: q.rejected().length });
    check(s.calls.some((c) => c.what === 'closed_session'), 'the sharing period was registered and the batch tried once more first');
    check(q.rejected()[0].status === 400 && /check constraint/.test(q.rejected()[0].error), 'the HTTP status and message are kept', q.rejected()[0]);
    check(refusedCall >= 3 && q.waiting() === 0, 'the next batch is still sent', { calls: s.calls.map((c) => c.what), waiting: q.waiting() });
    s.set('ok');
    q.retryRejected();
    r = await sync.flush();
    check(r.sent === 500 && r.rejected === 0 && q.waiting() === 0, 'put back in line, they go through', r);
  }

  // --- 4. the heartbeat history goes after the points, in batches, and survives a drop ----
  {
    const q = memoryStore();
    const s = fakeServer();
    const sync = makeSync(q, s);
    q.addPoints(10);
    q.addHeartbeats(HEARTBEAT_BATCH + 20);
    let r = await sync.flush();
    check(s.calls.map((c) => c.what).join(',') === 'points,heartbeats,heartbeats' && s.calls[1].n === HEARTBEAT_BATCH && q.heartbeats() === 0,
      'heartbeats go after the points, 500 then 20', s.calls);
    q.addHeartbeats(5);
    s.set('network', 0);
    r = await sync.flush({ force: true });
    check(r.offline && q.heartbeats() === 5, 'a dropped connection keeps the heartbeat rows', { r, left: q.heartbeats() });
  }

  // --- 5. ops first: an op that cannot be sent holds the points back, in order --------
  {
    const q = memoryStore();
    const s = fakeServer();
    const sync = makeSync(q, s);
    q.add({ kind: 'employee_patch', id: 'e1', patch: { language: 'si' } });
    q.addPoints(3);
    s.set('network', 0);
    const r = await sync.flush();
    check(r.offline && q.ops() === 1 && q.waiting() === 3 && !s.calls.some((c) => c.what === 'points'), 'nothing is sent out of order', { r, calls: s.calls });
    s.set('ok');
    clock.now = sync.backoff().nextTryAt;
    const r2 = await sync.flush();
    check(r2.sent === 4 && s.calls.map((c) => c.what).join(',') === 'employee,employee,points', 'then the op, then the points', s.calls);
  }

  console.log(failures === 0 ? '\nAll sync tests passed.' : `\n${failures} sync test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
