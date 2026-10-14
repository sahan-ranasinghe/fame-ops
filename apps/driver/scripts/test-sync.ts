// Tests of the offline queue's engine (src/sync/engine.ts) with a fake server:
// batch order and size, the backoff after a failed connection, points the
// server refuses (kept, marked, tried again), the heartbeat history after the
// points, ops blocking points, and the fuel video upload (chunks of exactly
// 6 MB, resume from the server's offset after a drop, a new upload after 410,
// Wi-Fi only, the row patched at the end). Pure code, no stack needed:
//
//   npm run test:sync          (from apps/driver)

import * as realApi from '../src/lib/api';
import { ApiError, type HeartbeatRow } from '../src/lib/api';
import { CHUNK_BYTES, type UploadMeta, type VideoStore } from '../src/lib/videoStore';
import {
  BACKOFF_MS,
  type Connection,
  createSync,
  HEARTBEAT_BATCH,
  type Op,
  POINT_BATCH,
  type QueueStore,
  type StoredHeartbeat,
  type StoredOp,
  type StoredPoint,
  type VideoUploadOp,
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
    updateOp: (id, op) => {
      const found = ops.find((item) => item.seq === id);
      if (found) found.op = op;
    },
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
    opAt: (i: number) => ops[i],
  };
}

/** A fake resumable-upload server: keeps the bytes it was given per upload, fails the way it is told. */
function fakeVideoServer() {
  const uploads = new Map<string, { meta: UploadMeta; got: number; expired?: boolean }>();
  const log: string[] = [];
  let n = 0;
  let dropAfterChunks = Infinity;
  let chunksSent = 0;
  const store: VideoStore = {
    async createUpload(meta) {
      const url = `https://fake/upload/${++n}`;
      uploads.set(url, { meta, got: 0 });
      log.push(`create:${meta.path}:${meta.bytes}`);
      return { url };
    },
    async offset(url) {
      const u = uploads.get(url);
      if (!u || u.expired) throw new ApiError('video: the upload expired on the server', true, 'gone', 410);
      log.push(`head:${u.got}`);
      return u.got;
    },
    async sendChunk(url, offset, bytes) {
      const u = uploads.get(url);
      if (!u || u.expired) throw new ApiError('video: the upload expired on the server', true, 'gone', 410);
      if (offset !== u.got) throw new ApiError('video: offset mismatch', false, 'offset', 409);
      if (chunksSent >= dropAfterChunks) {
        chunksSent = 0;
        dropAfterChunks = Infinity;
        throw new ApiError('video: Network request failed', false);
      }
      chunksSent += 1;
      u.got += bytes.length;
      log.push(`chunk:${offset}+${bytes.length}`);
      return u.got;
    },
  };
  return {
    store,
    log,
    uploads,
    dropAfter: (chunks: number) => {
      dropAfterChunks = chunks;
      chunksSent = 0;
    },
    expire: (url: string) => {
      const u = uploads.get(url);
      if (u) u.expired = true;
    },
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
    patchFuelVideo: async (_client: unknown, id: string, patch: realApi.FuelVideoPatch) => {
      calls.push({ what: `fuel_video:${patch.video_status}`, n: 1, first: id });
    },
    insertFuelLog: async (_client: unknown, row: realApi.FuelInsert) => {
      calls.push({ what: 'fuel_log', n: 1, first: row.id });
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

  // --- 6. a fuel video: 6 MB chunks, the offset kept, resume after a drop, a new upload after 410, Wi-Fi only ----
  {
    const q = memoryStore();
    const s = fakeServer();
    const v = fakeVideoServer();
    const file = new Uint8Array(CHUNK_BYTES * 2 + 1234);
    for (let i = 0; i < file.length; i += 4096) file[i] = i & 255;
    let wifiOnly = false;
    let connection: Connection = 'cellular';
    const removed: string[] = [];
    const progress: number[] = [];
    const sync = createSync({
      client: {} as realApi.Client,
      store: q.store,
      employeeId: () => 'e1',
      uploadFile: async () => undefined,
      removeFile: (uri) => void removed.push(uri),
      api: s.api,
      now: () => clock.now,
      video: v.store,
      readChunk: async (_uri, offset, length) => file.subarray(offset, offset + length),
      fileSize: (uri) => (uri === 'file:///videos/v1.mp4' ? file.length : null),
      wifiOnly: () => wifiOnly,
      connection: async () => connection,
      onProgress: (op) => void progress.push(op.offset),
    });
    const videoOp = (id: string, uri = 'file:///videos/v1.mp4'): VideoUploadOp => ({
      kind: 'video_upload', fuel_log_id: id, bucket: 'fuel-videos', path: `e1/2026-10-14/${id}.mp4`, local_uri: uri, bytes: file.length, url: null, offset: 0, content_type: 'video/mp4',
    });
    q.add({ kind: 'fuel_log', row: { id: 'f1', vehicle_id: 'v', employee_id: 'e1', video_status: 'recorded', video_bytes: file.length } as realApi.FuelInsert }, videoOp('f1'));
    q.add({ kind: 'employee_patch', id: 'e1', patch: { language: 'si' } });

    // The connection drops after the first chunk: the offset is kept; the next run asks the server and goes on.
    v.dropAfter(1);
    let r = await sync.flush();
    check(r.offline && r.sent === 1 && q.ops() === 2, 'the row went; the video dropped after one chunk and is kept with the rest behind it', { r, ops: q.ops() });
    const kept = q.opAt(0)!.op as VideoUploadOp;
    check(kept.url !== null && kept.offset === CHUNK_BYTES, 'the op remembers the upload URL and the bytes the server has', { url: kept.url, offset: kept.offset });
    check(v.log.join(',') === `create:e1/2026-10-14/f1.mp4:${file.length},chunk:0+${CHUNK_BYTES}`, 'the first chunk is exactly 6 MB', v.log);
    check(s.calls.some((c) => c.what === 'fuel_video:uploading'), 'the row says uploading once the upload exists');
    clock.now = sync.backoff().nextTryAt;
    r = await sync.flush();
    check(r.sent === 2 && q.ops() === 0 && !r.offline, 'the rest of the video and the op behind it go through', { r, ops: q.ops() });
    check(v.log.slice(2).join(',') === `head:${CHUNK_BYTES},chunk:${CHUNK_BYTES}+${CHUNK_BYTES},chunk:${CHUNK_BYTES * 2}+1234`, 'resumed from the server\'s offset, 6 MB then the 1,234-byte tail', v.log);
    check(s.calls.filter((c) => c.what === 'fuel_video:uploaded' && c.first === 'f1').length === 1 && removed.join() === 'file:///videos/v1.mp4', 'the row is marked uploaded and the file deleted', { calls: s.calls, removed });
    check(progress.join(',') === `${CHUNK_BYTES},${CHUNK_BYTES * 2},${file.length}`, 'the screens hear every chunk', progress);

    // An upload that expired on the server (410): a new one starts from 0.
    q.add(videoOp('f2'));
    v.dropAfter(1);
    await sync.flush();
    const half = q.opAt(0)!.op as VideoUploadOp;
    v.expire(half.url!);
    clock.now = sync.backoff().nextTryAt;
    r = await sync.flush();
    check(r.sent === 1 && q.ops() === 0 && v.log.filter((l) => l.startsWith('create:e1/2026-10-14/f2')).length === 2, 'after 410 a new upload is created and sent from 0', v.log.slice(-5));

    // Wi-Fi only: the video waits on mobile data and the ops behind it still go; on Wi-Fi it goes.
    q.add(videoOp('f3'), { kind: 'employee_patch', id: 'e1', patch: { language: 'en' } });
    wifiOnly = true;
    r = await sync.flush();
    check(r.deferred === 1 && r.sent === 1 && q.ops() === 1 && (q.opAt(0)!.op as VideoUploadOp).fuel_log_id === 'f3', 'on mobile data the video is stepped over, the op behind it is sent', { r, ops: q.ops() });
    connection = 'wifi';
    r = await sync.flush();
    check(r.sent === 1 && q.ops() === 0, 'on Wi-Fi it goes', r);

    // A file gone from the phone: the op fails for good and the row says failed.
    q.add(videoOp('f4', 'file:///videos/gone.mp4'));
    wifiOnly = false;
    r = await sync.flush();
    check(r.failed === 1 && s.calls.some((c) => c.what === 'fuel_video:failed' && c.first === 'f4'), 'a missing file marks the op failed and the row failed', { r, calls: s.calls.slice(-2) });
  }

  console.log(failures === 0 ? '\nAll sync tests passed.' : `\n${failures} sync test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
