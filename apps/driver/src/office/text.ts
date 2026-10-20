// Office mode (Phase 8, O1): one sentence for the person when a call fails (the site's errors.ts errText, as i18n keys), and
// what would fix it. A write that was dropped says it may not have been saved (the retry rule: never repeated by itself).

import type { FleetError } from './types';

export type Fix = 'retry' | 'signin' | null;

/** The i18n key of the sentence, with the server's own words where it gave them, and the fix. */
export function errorText(e: FleetError | undefined | null): { key: string; words?: string; fix: Fix } {
  switch (e?.code) {
    case 'network':
    case 'upstream_error':
    case 'server_unavailable':
    case 'rate_limited':
      return e.write ? { key: 'office.error.writeDropped', fix: 'retry' } : { key: 'office.error.dropped', fix: 'retry' };
    case 'timeout':
      return e.write ? { key: 'office.error.writeTimeout', fix: 'retry' } : { key: 'office.error.timeout', fix: 'retry' };
    // A photo that did not go up (office/media.ts): said in the person's language, with Try again.
    case 'upload_failed':
      return { key: 'office.error.uploadFailed', fix: 'retry' };
    case 'upload_expired':
      return { key: 'office.error.uploadExpired', fix: 'retry' };
    case 'not_signed_in':
    case 'mfa_required':
      return { key: 'office.error.signedOut', fix: 'signin' };
    case 'not_an_office_user':
      return { key: 'office.error.noOfficeRole', fix: null };
    case 'switched_off':
      return { key: 'office.error.switchedOff', fix: null };
    case 'forbidden':
      return { key: 'office.error.forbidden', words: cleanMsg(e.message), fix: null };
    case 'bad_input':
      return { key: 'office.error.badInput', words: cleanMsg(e.message), fix: null };
    case 'tool_error':
      return { key: 'office.error.refused', words: cleanMsg(e.message), fix: null };
    default:
      return { key: 'office.error.unknown', words: cleanMsg(e?.message), fix: 'retry' };
  }
}

export function cleanMsg(m: unknown): string {
  if (!m) return '';
  const s = String(m);
  try {
    const j = JSON.parse(s) as { error?: { message?: string; code?: string } | string; message?: string };
    if (j && typeof j === 'object') {
      if (typeof j.error === 'string') return j.error;
      if (j.error) return j.error.message || j.error.code || s;
      return j.message || s;
    }
    return s;
  } catch {
    return s.replace(/^Error:\s*/, '');
  }
}

/** The person's first name for "Morning, Sahan". */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** Two letters for an avatar: "Sahan Ranasinghe" → "SR". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length === 0 ? '?' : parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
