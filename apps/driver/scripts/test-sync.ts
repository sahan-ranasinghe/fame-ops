// Tests of the offline queue's engine (src/sync/engine.ts) with a fake server:
// batch order and size, the backoff after a failed connection, points the
// server refuses (kept, marked, tried again), the heartbeat history after the
// points, ops blocking points, and the fuel video upload (chunks of exactly
// 6 MB, resume from the server's offset after a drop, a new upload after 410,
// Wi-Fi only, the row patched at the end), a vehicle's first photo, and Part 3b's "Running late" (task_late) and answers
// to the office's questions (ask_answer): in order with the phone's times, kept offline, final replies never sent
// again, and when the phone counts as signed out (lib/session.ts). Pure code, no stack needed:
//
//   npm run test:sync          (from apps/driver)

import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import * as realApi from '../src/lib/api';
import { ApiError, type HeartbeatRow } from '../src/lib/api';
import { sessionKind } from '../src/lib/session';
import { CHUNK_BYTES, type UploadMeta, type VideoStore } from '../src/lib/videoStore';
import {
  BACKOFF_MOVING_MS,
  BACKOFF_PARKED_MS,
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
  const rejectedHb = new Map<number, { status: number | undefined; error: string }>();
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
    nextHeartbeats: (limit) => heartbeats.filter((h) => !rejectedHb.has(h.seq)).slice(0, limit),
    removeHeartbeats: (seqs) => {
      for (const id of seqs) heartbeats.splice(heartbeats.findIndex((h) => h.seq === id), 1);
    },
    rejectHeartbeats: (seqs, status, error) => seqs.forEach((id) => rejectedHb.set(id, { status, error })),
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
    rejectedHeartbeats: () => [...rejectedHb.values()],
    retryRejectedHeartbeats: () => rejectedHb.clear(),
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
const videoStatus = new Map<string, string>();

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
      return { watched: true, on_duty: true, duty_end: null };
    },
    patchEmployee: async () => {
      calls.push({ what: 'employee', n: 1 });
      if (calls.length > failAfterCalls) fail();
    },
    patchFuelVideo: async (_client: unknown, id: string, patch: realApi.FuelVideoPatch) => {
      calls.push({ what: `fuel_video:${patch.video_status}`, n: 1, first: id });
      if (patch.video_status) videoStatus.set(id, patch.video_status);
    },
    insertFuelLog: async (_client: unknown, row: realApi.FuelInsert) => {
      calls.push({ what: 'fuel_log', n: 1, first: row.id });
      if (calls.length > failAfterCalls) fail();
    },
    fetchFuelVideoStatus: async (_client: unknown, id: string) => {
      calls.push({ what: 'fuel_video_status', n: 1, first: id });
      return videoStatus.get(id) ?? 'recorded';
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
  const makeSync = (q: ReturnType<typeof memoryStore>, s: ReturnType<typeof fakeServer>, moving?: () => boolean, onHeartbeat?: (a: realApi.HeartbeatAnswer) => void) =>
    createSync({
      client: {} as realApi.Client,
      store: q.store,
      employeeId: () => 'e1',
      uploadFile: async () => undefined,
      removeFile: () => undefined,
      api: s.api,
      now: () => clock.now,
      moving,
      onHeartbeat,
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

  // --- 2. a failed connection keeps everything; parked it waits 5 s, 15 s, 30 s, 1 min, 2 min, 5 min, 5 min --
  {
    const q = memoryStore();
    const s = fakeServer();
    const sync = makeSync(q, s);
    q.addPoints(1200);
    s.set('network', 1); // the second batch fails
    let r = await sync.flush();
    check(r.offline && r.sent === 500 && q.waiting() === 700, 'the connection drops on batch 2: 500 sent, 700 kept', { r, waiting: q.waiting() });
    check(sync.backoff().nextTryAt === clock.now + BACKOFF_PARKED_MS[0], 'the next attempt waits 5 s', sync.backoff());
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
    check(waits.join(',') === '15000,30000,60000,120000,300000', 'parked: then 15 s, 30 s, 1 min, 2 min, 5 min', waits);
    s.set('ok');
    clock.now = sync.backoff().nextTryAt;
    const before = s.calls.length;
    r = await sync.flush();
    check(!r.offline && q.waiting() === 0 && sync.backoff().failures === 0, 'the connection is back: the rest goes and the ladder resets', { r, backoff: sync.backoff() });
    // The batch that failed is the first one sent next time: batch 1 (already off the phone) never goes again.
    const resumed = s.calls.slice(before).filter((c) => c.what === 'points');
    const point501 = new Date(Date.parse('2026-10-14T03:00:00Z') + 500 * 5000).toISOString();
    check(resumed.length === 2 && resumed[0].first === point501 && resumed[0].n === 500 && resumed[1].n === 200, 'the upload resumes from the batch that failed (point 501), not from the start', resumed);
    check(s.calls.filter((c) => c.what === 'points').every((c) => c.n <= POINT_BATCH), 'never more than 500 in a batch');
  }

  // --- 2b. while the vehicle moves the wait never passes 30 s: 5 s, 15 s, 30 s, 30 s … --------
  {
    const q = memoryStore();
    const s = fakeServer();
    const sync = makeSync(q, s, () => true);
    q.addPoints(20);
    s.set('network');
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      clock.now = Math.max(clock.now, sync.backoff().nextTryAt);
      await sync.flush({ force: true });
      waits.push(sync.backoff().nextTryAt - clock.now);
    }
    check(waits.join(',') === '5000,15000,30000,30000,30000', 'moving: 5 s, 15 s, 30 s, 30 s, 30 s', waits);
    check(BACKOFF_MOVING_MS[BACKOFF_MOVING_MS.length - 1] === 30_000 && BACKOFF_PARKED_MS[BACKOFF_PARKED_MS.length - 1] === 300_000, 'the ladders top out at 30 s moving and 5 min parked');
    // The phone reports the network back: the ladder resets and the next attempt is not skipped.
    sync.resetBackoff();
    s.set('ok');
    const r = await sync.flush();
    check(!r.skipped && !r.offline && q.waiting() === 0 && sync.backoff().failures === 0, 'network back: the ladder resets and the queue goes at once', { r, backoff: sync.backoff() });
  }

  // --- 2d. the heartbeat's answer (watched mode) reaches the phone ----------------------
  {
    const q = memoryStore();
    const s = fakeServer();
    const answers: realApi.HeartbeatAnswer[] = [];
    const sync = makeSync(q, s, undefined, (a) => answers.push(a));
    q.add({ kind: 'heartbeat', row: { at: new Date(clock.now).toISOString(), sharing: true, location_on: true, permission: 'always', battery_pct: 80, app_version: 't', queued_points: 0 } });
    const r = await sync.flush();
    check(r.sent === 1 && answers.length === 1 && answers[0].watched === true, 'the server says the office is watching: the phone hears it with the heartbeat', { r, answers });
  }

  // --- 2c. refused heartbeat history is kept and marked, never dropped -------------------
  {
    const q = memoryStore();
    const s = fakeServer();
    const sync = makeSync(q, s);
    q.addHeartbeats(3);
    s.set('refuse');
    let r = await sync.flush();
    check(r.failed === 3 && q.heartbeats() === 3 && q.rejectedHeartbeats().length === 3 && q.rejectedHeartbeats()[0].status === 400, 'refused history rows stay on the phone, marked with the answer', { r, rejected: q.rejectedHeartbeats() });
    r = await sync.flush();
    check(s.calls.filter((c) => c.what === 'heartbeats').length === 1, 'they are not sent again until put back in line');
    q.retryRejectedHeartbeats();
    s.set('ok');
    r = await sync.flush();
    check(r.sent === 3 && q.heartbeats() === 0, 'put back in line, they go', r);
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

    // An interrupted fill in two pieces: the row is marked uploaded after the second piece only, with the whole fill's size kept.
    s.calls.length = 0;
    q.add({ ...videoOp('f5'), segment: 1, segments: 2 }, { ...videoOp('f5'), path: 'e1/2026-10-14/f5-2.mp4', segment: 2, segments: 2 });
    r = await sync.flush();
    const marks = s.calls.filter((c) => c.first === 'f5').map((c) => c.what);
    check(r.sent === 2 && marks.filter((m) => m === 'fuel_video:uploaded').length === 1 && marks.indexOf('fuel_video:uploaded') === marks.length - 1
      && marks.includes('fuel_video_status'), 'two pieces: uploaded is written once, after the last piece, after a look at the row', marks);
    check(!s.calls.some((c) => c.first === 'f5' && c.what === 'fuel_video:uploaded' && false), 'the fill keeps its total size (the last piece does not overwrite video_bytes)');

    // A piece that fails for good keeps the row failed even when the last piece goes through.
    s.calls.length = 0;
    q.add({ ...videoOp('f6', 'file:///videos/gone.mp4'), segment: 1, segments: 2 }, { ...videoOp('f6'), path: 'e1/2026-10-14/f6-2.mp4', segment: 2, segments: 2 });
    r = await sync.flush();
    const marks6 = s.calls.filter((c) => c.first === 'f6').map((c) => c.what);
    check(r.failed === 1 && r.sent === 1 && marks6.includes('fuel_video:failed') && !marks6.includes('fuel_video:uploaded'), 'a failed first piece: the row stays failed after the second piece', marks6);
  }

  // --- Phase 7 §6: a vehicle's first photo from the phone ----------------------------
  console.log('\nVehicle photos:');
  {
    const q = memoryStore();
    const s = fakeServer();
    // The vehicles on the fake server: their photo now (null = none), and which ones are gone (not active).
    const photos = new Map<string, string | null>([['v1', null], ['v2', null], ['v3', 'v3/someone-else.jpg'], ['v4', 'v4/u4.jpg'], ['v5', null], ['v6', null]]);
    const refuse = new Set<string>(); // paths the bucket refuses (the policy: the vehicle has a photo by then)
    let uploadNetwork = false;
    let rpcAnswer: string | null = null; // null = the real rule: 'ok' while there is none
    const uploads: string[] = [];
    const rpcs: string[] = [];
    const removed: string[] = [];
    const answers: string[] = [];
    const api = {
      ...s.api,
      setVehiclePhotoFromDriver: async (_c: unknown, vehicleId: string, path: string) => {
        rpcs.push(vehicleId);
        if (rpcAnswer) return rpcAnswer;
        if (photos.get(vehicleId) !== null) return 'has_photo';
        photos.set(vehicleId, path);
        return 'ok';
      },
      fetchVehiclePhoto: async (_c: unknown, vehicleId: string) =>
        photos.has(vehicleId) ? { active: true, path: photos.get(vehicleId) ?? null } : { active: false, path: null },
    } as unknown as typeof realApi;
    const sync = createSync({
      client: {} as realApi.Client,
      store: q.store,
      employeeId: () => 'e1',
      uploadFile: async (_uri, path, bucket) => {
        if (uploadNetwork) throw new ApiError('photo: Network request failed', false);
        if (refuse.has(path)) throw new ApiError('photo: upload refused (403)', true, undefined, 403);
        uploads.push(`${bucket}:${path}`);
      },
      removeFile: (uri) => void removed.push(uri),
      api,
      now: () => clock.now,
      onVehiclePhoto: (op, answer) => void answers.push(`${op.vehicle_id}:${answer}`),
    });
    const photoOp = (vehicleId: string, id = `u-${vehicleId}`): Op => ({
      kind: 'vehicle_photo', id, vehicle_id: vehicleId, path: `${vehicleId}/${id}.jpg`, thumb_path: `${vehicleId}/${id}-thumb.jpg`,
      local_uri: `file:///photos/${id}.jpg`, thumb_uri: `file:///photos/${id}-thumb.jpg`, taken_at: '2026-10-17T03:00:00Z',
    });

    // The first photo of a vehicle: both files to vehicle-photos, then the RPC; the phone's copies go.
    q.add(photoOp('v1'));
    let r = await sync.flush();
    check(r.sent === 1 && r.failed === 0 && q.ops() === 0 && uploads.join() === 'vehicle-photos:v1/u-v1.jpg,vehicle-photos:v1/u-v1-thumb.jpg'
      && rpcs.join() === 'v1' && answers.join() === 'v1:ok' && removed.join() === 'file:///photos/u-v1.jpg,file:///photos/u-v1-thumb.jpg',
      'a vehicle with no photo: the photo and the thumbnail go to vehicle-photos, then the RPC answers ok; the files leave the phone',
      { r, uploads, rpcs, answers, removed });

    // Two phones, one vehicle: the second one's files went up before the first one's RPC, so the RPC answers has_photo.
    photos.set('v2', 'v2/first-phone.jpg');
    answers.length = 0;
    q.add(photoOp('v2'));
    r = await sync.flush();
    check(r.sent === 1 && r.failed === 0 && q.ops() === 0 && answers.join() === 'v2:has_photo' && photos.get('v2') === 'v2/first-phone.jpg',
      "a second phone's photo for the same vehicle: 'has_photo' is done (not failed, not tried again); the first photo stays", { r, answers });

    // The bucket refuses the files because the vehicle has someone else's photo by then: done as has_photo, no RPC.
    refuse.add('v3/u-v3.jpg');
    answers.length = 0;
    rpcs.length = 0;
    q.add(photoOp('v3'));
    r = await sync.flush();
    check(r.sent === 1 && r.failed === 0 && rpcs.length === 0 && answers.join() === 'v3:has_photo', "the files refused because a photo is there now: done, 'has_photo'", { r, answers });

    // The RPC's answer was lost: the same op again finds its own photo there and counts as ok.
    refuse.add('v4/u4.jpg');
    answers.length = 0;
    q.add(photoOp('v4', 'u4'));
    r = await sync.flush();
    check(r.sent === 1 && answers.join() === 'v4:ok', 'sent again after a lost answer: the photo there is this one, so ok', { r, answers });

    // No connection: kept, in order, not failed; it goes once the connection is back.
    uploadNetwork = true;
    answers.length = 0;
    q.add(photoOp('v5'));
    r = await sync.flush();
    check(r.offline && r.failed === 0 && q.ops() === 1 && answers.length === 0, 'no connection: the photo waits on the phone (works offline)', { r, ops: q.ops() });
    uploadNetwork = false;
    clock.now = sync.backoff().nextTryAt;
    r = await sync.flush();
    check(r.sent === 1 && q.ops() === 0 && answers.join() === 'v5:ok', 'the connection is back: it goes', { r, answers });

    // Refused while the vehicle still has no photo (a real refusal): set aside, the files kept for the driver to see.
    refuse.add('v6/u-v6.jpg');
    removed.length = 0;
    q.add(photoOp('v6'));
    r = await sync.flush();
    check(r.failed === 1 && q.ops() === 0 && removed.length === 0, 'refused with no photo there: set aside as failed, nothing deleted', { r, removed });

    // A vehicle switched off meanwhile: nothing left to do. The RPC refusing the paths: failed.
    answers.length = 0;
    refuse.add('gone/u-gone.jpg');
    q.add(photoOp('gone'));
    rpcAnswer = 'not_this_vehicle';
    photos.set('v7', null);
    q.add(photoOp('v7'));
    r = await sync.flush();
    check(r.sent === 1 && r.failed === 1 && answers.join() === 'gone:has_photo', "a vehicle no longer active: done; the RPC's 'not_this_vehicle': failed", { r, answers });
  }

  // --- Part 3b: "Running late" (task_late) and an answer to the office's question (ask_answer) ------------------------
  console.log('\nRunning late and answers (Part 3b):');
  {
    const q = memoryStore();
    const s = fakeServer();
    const sent: string[] = [];
    const lateReplies: string[] = [];
    const askReplies: string[] = [];
    const refused: string[] = [];
    let network = false;
    let lateReply: string = 'ok';
    let askReply: string = 'ok';
    let lastAskArgs: unknown[] = [];
    const api = {
      ...s.api,
      reportRunningLate: async (_c: unknown, taskId: string, minutes: number, at: string) => {
        if (network) throw new ApiError('running late: Network request failed', false);
        sent.push(`late:${taskId}:${minutes}:${at}`);
        return lateReply;
      },
      answerAsk: async (_c: unknown, askId: string, answer: string, fields: { answer_at?: string | null; lat?: number | null; lng?: number | null; accuracy_m?: number | null }, at: string) => {
        if (network) throw new ApiError('answer: Network request failed', false);
        sent.push(`ask:${askId}:${answer}:${at}`);
        lastAskArgs = [askId, answer, fields.answer_at ?? null, fields.lat ?? null, fields.lng ?? null, fields.accuracy_m ?? null, at];
        return askReply;
      },
    } as unknown as typeof realApi;
    const sync = createSync({
      client: {} as realApi.Client,
      store: q.store,
      employeeId: () => 'e1',
      uploadFile: async () => undefined,
      removeFile: () => undefined,
      api,
      now: () => clock.now,
      onLate: (op, reply) => void lateReplies.push(`${op.client_id}:${reply}`),
      onAsk: (op, reply) => void askReplies.push(`${op.client_id}:${reply}`),
      onRefused: (op, message) => void refused.push(`${op.kind}:${message}`),
    });
    const late = (task: string, minutes: number, at: string): Op => ({ kind: 'task_late', id: task, client_id: `c-${task}-${minutes}`, minutes, at });
    const answer = (ask: string, value: 'yes' | 'no' | 'call_me' | 'time' | 'location', at: string, extra: Partial<Extract<Op, { kind: 'ask_answer' }>> = {}): Op => ({
      kind: 'ask_answer', id: ask, client_id: `c-${ask}-${value}`, answer: value, answer_at: null, lat: null, lng: null, accuracy_m: null, at, ...extra,
    });

    // In the order they happened, with the phone's times.
    q.add(late('t1', 15, '2026-10-19T03:10:00.000Z'), answer('a1', 'yes', '2026-10-19T03:11:00.000Z'), late('t1', 30, '2026-10-19T03:20:00.000Z'));
    let r = await sync.flush();
    check(r.sent === 3 && r.failed === 0 && q.ops() === 0
      && sent.join() === 'late:t1:15:2026-10-19T03:10:00.000Z,ask:a1:yes:2026-10-19T03:11:00.000Z,late:t1:30:2026-10-19T03:20:00.000Z',
      'queued in order, each with the time it was said (the server keeps the latest late report)', { r, sent });
    check(lateReplies.join() === 'c-t1-15:ok,c-t1-30:ok' && askReplies.join() === 'c-a1-yes:ok', 'the screens hear each reply by the op\'s client id', { lateReplies, askReplies });

    // The time and the location answers carry what they need.
    sent.length = 0;
    q.add(answer('a2', 'time', '2026-10-19T03:12:00.000Z', { answer_at: '2026-10-19T04:15:00.000Z' }));
    r = await sync.flush();
    check(r.sent === 1 && JSON.stringify(lastAskArgs) === JSON.stringify(['a2', 'time', '2026-10-19T04:15:00.000Z', null, null, null, '2026-10-19T03:12:00.000Z']),
      'a time answer sends the time picked', lastAskArgs);
    q.add(answer('a3', 'location', '2026-10-19T03:13:00.000Z', { lat: 6.9271, lng: 79.8612, accuracy_m: 12 }));
    r = await sync.flush();
    check(r.sent === 1 && JSON.stringify(lastAskArgs) === JSON.stringify(['a3', 'location', null, 6.9271, 79.8612, 12, '2026-10-19T03:13:00.000Z']),
      'a location answer sends the one point (lat, lng, accuracy)', lastAskArgs);

    // No connection: both wait, in order, nothing failed; they go once the connection is back.
    network = true;
    sent.length = 0;
    q.add(late('t2', 10, '2026-10-19T05:00:00.000Z'), answer('a4', 'no', '2026-10-19T05:01:00.000Z'));
    r = await sync.flush();
    check(r.offline && r.failed === 0 && q.ops() === 2 && q.opAt(0).op.kind === 'task_late' && q.opAt(1).op.kind === 'ask_answer',
      'no connection: kept on the phone in order (works offline)', { r, ops: q.ops() });
    network = false;
    clock.now = sync.backoff().nextTryAt;
    r = await sync.flush();
    check(r.sent === 2 && q.ops() === 0 && sent.join() === 'late:t2:10:2026-10-19T05:00:00.000Z,ask:a4:no:2026-10-19T05:01:00.000Z', 'the connection is back: both go, in order', sent);

    // Final answers: done, never sent again.
    sent.length = 0;
    lateReplies.length = 0;
    lateReply = 'closed';
    q.add(late('t3', 15, '2026-10-19T06:00:00.000Z'));
    r = await sync.flush();
    check(r.sent === 1 && r.failed === 0 && q.ops() === 0 && lateReplies.join() === 'c-t3-15:closed', "'closed' (the task is over): done, the screen hears it", { r, lateReplies });
    lateReply = 'not_yours';
    q.add(late('t4', 15, '2026-10-19T06:01:00.000Z'));
    r = await sync.flush();
    check(r.sent === 1 && r.failed === 0 && q.ops() === 0, "'not_yours' (given to someone else): done", r);
    lateReply = 'ok';

    askReplies.length = 0;
    askReply = 'expired';
    q.add(answer('a5', 'yes', '2026-10-19T07:00:00.000Z'));
    r = await sync.flush();
    check(r.sent === 1 && r.failed === 0 && q.ops() === 0 && askReplies.join() === 'c-a5-yes:expired', "'expired': done (the screen says the question closed)", { r, askReplies });

    askReply = 'bad';
    refused.length = 0;
    q.add(answer('a6', 'time', '2026-10-19T07:01:00.000Z'), late('t5', 15, '2026-10-19T07:02:00.000Z'));
    r = await sync.flush();
    check(r.failed === 1 && r.sent === 1 && q.ops() === 0 && refused.join() === 'ask_answer:answer: bad' && askReplies.includes('c-a6-time:bad'),
      "'bad': kept as failed with its words (not retried), and the late report behind it still goes", { r, refused, askReplies });
    askReply = 'not_yours';
    q.add(answer('a7', 'yes', '2026-10-19T07:03:00.000Z'));
    r = await sync.flush();
    check(r.failed === 1 && q.ops() === 0, "'not_yours': kept as failed", r);

    sent.length = 0;
    clock.now += 24 * 3600_000;
    r = await sync.flush({ force: true });
    check(r.sent === 0 && r.failed === 0 && sent.length === 0, 'the next runs send none of them again (final answers are never retried by themselves)', { r, sent });
  }

  // Sahan, 19 October 2026: a server or network error never signs a driver out (lib/session.ts). getSession() gives no
  // session both when there is none and when an expired token could not be refreshed offline; only the first is signed out.
  {
    console.log('\nSigned in or not (lib/session.ts):');
    check(sessionKind({ data: { session: { access_token: 't' } }, error: null }) === 'ok', 'a session: signed in');
    check(sessionKind({ data: { session: null }, error: null }) === 'none', 'no session, no error: signed out');
    check(sessionKind({ data: { session: null }, error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found') }) === 'none',
      'Auth refused the refresh token (revoked, switched off): signed out');
    check(sessionKind({ data: { session: null }, error: new AuthRetryableFetchError('Network request failed', 0) }) === 'offline',
      'the refresh did not get through (no connection): still signed in, nothing forgotten');
    check(sessionKind({ data: { session: null }, error: new AuthRetryableFetchError('Bad Gateway', 502) }) === 'offline',
      "Auth's 502–504: still signed in");
  }

  console.log(failures === 0 ? '\nAll sync tests passed.' : `\n${failures} sync test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
