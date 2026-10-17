// 1-hour links to the private buckets, made by the app itself where a policy lets the driver read: their own photo
// (driver-photos), every vehicle's photo (vehicle-photos) and the held vehicle's documents (vehicle-docs). Phase 7
// §5, §6, §28. A link is kept in memory for 50 minutes so a list does not ask again on every screen; nothing is kept
// on the phone. Without a connection there is no link: the screens show their placeholder or "Needs a connection".

import { useEffect, useState } from 'react';

import { supabase } from './supabase';

const LIFETIME_S = 3600;
const KEEP_MS = 50 * 60_000;
const cache = new Map<string, { url: string; until: number }>();
const key = (bucket: string, path: string) => `${bucket}/${path}`;

function cached(bucket: string, path: string): string | null {
  const hit = cache.get(key(bucket, path));
  return hit && hit.until > Date.now() ? hit.url : null;
}

export type SignedUrl = { url: string } | { error: 'network' | 'refused' };

/** One link. 'refused' = the server said no (not allowed, not there); 'network' = no answer. */
export async function signedUrl(bucket: string, path: string): Promise<SignedUrl> {
  const hit = cached(bucket, path);
  if (hit) return { url: hit };
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, LIFETIME_S);
    if (error || !data?.signedUrl) return { error: error?.name === 'StorageApiError' ? 'refused' : 'network' };
    cache.set(key(bucket, path), { url: data.signedUrl, until: Date.now() + KEEP_MS });
    return { url: data.signedUrl };
  } catch {
    return { error: 'network' };
  }
}

/** Links for many files of one bucket in one request (the vehicle picker's thumbnails); the ones that fail are left out. */
export async function signedUrls(bucket: string, paths: string[]): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const missing: string[] = [];
  for (const path of new Set(paths)) {
    const hit = cached(bucket, path);
    if (hit) found[path] = hit;
    else missing.push(path);
  }
  if (missing.length === 0) return found;
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(missing, LIFETIME_S);
    for (const item of data ?? []) {
      if (!item.path || !item.signedUrl || item.error) continue;
      cache.set(key(bucket, item.path), { url: item.signedUrl, until: Date.now() + KEEP_MS });
      found[item.path] = item.signedUrl;
    }
  } catch {
    // No connection: the screen shows what it has.
  }
  return found;
}

/** The links for these paths (path → url), filled in as they arrive; empty paths are skipped. A new `again` asks again. */
export function useSignedUrls(bucket: string, paths: (string | null | undefined)[], again: unknown = 0): Record<string, string> {
  const wanted = paths.filter((p): p is string => typeof p === 'string' && p !== '');
  const list = [...new Set(wanted)].sort().join('\n');
  const [urls, setUrls] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {};
    for (const path of wanted) {
      const hit = cached(bucket, path);
      if (hit) start[path] = hit;
    }
    return start;
  });
  useEffect(() => {
    if (list === '') return;
    let live = true;
    void signedUrls(bucket, list.split('\n')).then((found) => {
      if (live) setUrls((old) => ({ ...old, ...found }));
    });
    return () => {
      live = false;
    };
  }, [bucket, list, again]);
  return urls;
}
