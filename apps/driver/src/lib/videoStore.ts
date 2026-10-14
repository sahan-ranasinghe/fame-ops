// Where a fuel video is uploaded to, behind one small interface (Phase 6,
// Part 3). SupabaseTusStore talks TUS (the resumable upload protocol) to
// Supabase Storage: create → the upload URL, head → the server's offset, patch
// → one chunk of exactly CHUNK_BYTES (the last one shorter). The queue engine
// (sync/engine.ts) drives it one chunk at a time and keeps the offset, so a
// lost signal or a restart continues where the server says. A DriveStore
// could replace it later without the queue code changing.
//
// Nothing here reads files: the engine hands over the bytes (readChunk in
// sync/index.ts reads the file at a position with expo-file-system/legacy).

import { ApiError } from './api';

/** Supabase Storage accepts chunks of exactly 6 MB (the last one shorter). */
export const CHUNK_BYTES = 6 * 1024 * 1024;
/** An upload URL lives this long on the server; after that a new upload starts from 0. */
export const UPLOAD_URL_TTL_MS = 24 * 3600_000;

export interface UploadMeta {
  bucket: string;
  path: string;
  contentType: string;
  bytes: number;
}

export interface VideoStore {
  /** Starts an upload; the URL is where the chunks go. */
  createUpload(meta: UploadMeta): Promise<{ url: string }>;
  /** How many bytes the server already has. Throws ApiError 'gone' (404 / 410) when the upload expired. */
  offset(url: string): Promise<number>;
  /** Sends one chunk starting at `offset`; returns the server's new offset. */
  sendChunk(url: string, offset: number, bytes: Uint8Array): Promise<number>;
}

/** The headers every TUS call carries. */
export interface TusAuth {
  /** The driver's access token; null = not signed in. */
  token(): Promise<string | null>;
  apiKey: string;
}

function encodeMetadata(meta: Record<string, string>): string {
  return Object.entries(meta).map(([k, v]) => `${k} ${base64Encode(v)}`).join(',');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of a UTF-8 string (RN has no Buffer, and atob/btoa are not everywhere). */
export function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b === undefined ? '=' : B64[(n >> 6) & 63]) + (c === undefined ? '=' : B64[n & 63]);
  }
  return out;
}

/** The bytes of a base64 string (what expo-file-system/legacy reads a file as). */
export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** An answer that means the upload is gone for good (expired on the server). */
const GONE = (status: number) => status === 404 || status === 410;

/** 4xx that is not "gone", a conflict, auth or rate limit: the server will never take it. */
const REFUSED = (status: number) => status >= 400 && status < 500 && !GONE(status) && status !== 401 && status !== 408 && status !== 409 && status !== 429;

export class SupabaseTusStore implements VideoStore {
  constructor(private readonly baseUrl: string, private readonly auth: TusAuth, private readonly fetchFn: typeof fetch = fetch) {}

  private async headers(extra: Record<string, string>): Promise<Record<string, string>> {
    const token = await this.auth.token();
    if (!token) throw new ApiError('video: not signed in', false);
    return { Authorization: `Bearer ${token}`, apikey: this.auth.apiKey, 'Tus-Resumable': '1.0.0', ...extra };
  }

  private async call(method: string, url: string, headers: Record<string, string>, body?: Uint8Array): Promise<Response> {
    try {
      return await this.fetchFn(url, { method, headers: await this.headers(headers), body: body as unknown as BodyInit | undefined });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`video: ${error instanceof Error ? error.message : 'network request failed'}`, false);
    }
  }

  async createUpload(meta: UploadMeta): Promise<{ url: string }> {
    const res = await this.call('POST', `${this.baseUrl}/storage/v1/upload/resumable`, {
      'Upload-Length': String(meta.bytes),
      'Upload-Metadata': encodeMetadata({ bucketName: meta.bucket, objectName: meta.path, contentType: meta.contentType, cacheControl: '3600' }),
      'x-upsert': 'false',
    });
    const url = res.headers.get('Location');
    if (res.status === 201 && url) return { url: absolute(url, this.baseUrl) };
    if (res.status === 409 || res.status === 423) throw new ApiError('video: the file is already there or locked', true, 'exists', res.status);
    throw new ApiError(`video: upload refused (${res.status})`, REFUSED(res.status), undefined, res.status);
  }

  async offset(url: string): Promise<number> {
    const res = await this.call('HEAD', url, {});
    if (GONE(res.status)) throw new ApiError('video: the upload expired on the server', true, 'gone', res.status);
    const offset = Number(res.headers.get('Upload-Offset'));
    if (res.status >= 200 && res.status < 300 && Number.isFinite(offset)) return offset;
    throw new ApiError(`video: offset refused (${res.status})`, REFUSED(res.status), undefined, res.status);
  }

  async sendChunk(url: string, offset: number, bytes: Uint8Array): Promise<number> {
    const res = await this.call('PATCH', url, { 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' }, bytes);
    if (GONE(res.status)) throw new ApiError('video: the upload expired on the server', true, 'gone', res.status);
    const next = Number(res.headers.get('Upload-Offset'));
    if (res.status === 204 && Number.isFinite(next)) return next;
    if (res.status === 409) throw new ApiError('video: offset mismatch', false, 'offset', res.status);
    throw new ApiError(`video: chunk refused (${res.status})`, REFUSED(res.status), undefined, res.status);
  }
}

/** Supabase answers a Location of its own host (kong inside Docker); keep ours. */
function absolute(location: string, baseUrl: string): string {
  if (location.startsWith('/')) return `${baseUrl}${location}`;
  try {
    const u = new URL(location);
    const base = new URL(baseUrl);
    if (u.host !== base.host) return `${base.origin}${u.pathname}${u.search}`;
  } catch {
    // Not a URL we understand: use it as given.
  }
  return location;
}
