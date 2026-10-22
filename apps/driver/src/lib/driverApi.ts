// The driver app's own server, the Edge Function driver-api (Phase 7, §13): what the phone cannot do with its
// row-level access alone. POST with JSON, the session's token and the publishable key; the server checks the driver.
//   /places/search {text, session?}       the office's search box: our places, the driver's own recent places, the map's
//                                          (Google's under the google package, credit "Google Maps")
//   /places/search {suggest, near?}        Round 4–7 (item 10): an empty box: Saved (the company's places) and Recent
//                                          (the driver's OWN trips' places, personal ones too), about 5 rows
//   /trips {id, purpose, destination, …}   Start a trip (idempotent by the phone's id: the queue can send it again)
//   /trips/:id/stops {id, destination}     a stop added on the way
//   /profile {phone?, whatsapp?, …}         Part 3b (G): the driver's own profile (only the fields that changed; null
//                                          clears one, never the phone); answers {saved, profile} with the numbers +94…
// No phone-only code here (the token and fetch are passed in), so scripts/test-trips.ts runs it with a fake server.
// The answers become ApiError like everything else the queue sends: permanent for a refusal (409, its words in the
// message, code 'refused') and any other 4xx; not permanent for no answer, 401, 408, 429 and 5xx.

import { ApiError } from './api';
import type { ProfilePatch } from './profile';
import { answerKind, errorWords, parseSearchAnswer, parseTripAnswer, type SearchAnswer, type StopRequest, type TripAnswer, type TripRequest } from './trips';

/** A search waits this long for its answer; a trip a little longer (it may fetch a Google pin first). */
export const SEARCH_TIMEOUT_MS = 10_000;
export const TRIP_TIMEOUT_MS = 20_000;
/** The profile's save waits this long (the screen then says "No connection"). */
export const PROFILE_TIMEOUT_MS = 15_000;

/** The profile as driver-api /profile answers it (the numbers +94…; a cleared field null). */
export type SavedProfile = Required<ProfilePatch>;

/** driver-api /profile's answer, read defensively: the fields saved and the profile now (null when it had none). */
export function parseProfileAnswer(raw: unknown): { saved: string[]; profile: SavedProfile } | null {
  const o = (raw ?? {}) as { saved?: unknown; profile?: unknown };
  if (!o.profile || typeof o.profile !== 'object') return null;
  const p = o.profile as Record<string, unknown>;
  const field = (key: keyof ProfilePatch): string | null => (typeof p[key] === 'string' && p[key] !== '' ? (p[key] as string) : null);
  return {
    saved: Array.isArray(o.saved) ? o.saved.filter((s): s is string => typeof s === 'string') : [],
    profile: {
      phone: field('phone'),
      whatsapp: field('whatsapp'),
      emergency_name: field('emergency_name'),
      emergency_relation: field('emergency_relation'),
      emergency_phone: field('emergency_phone'),
      licence_no: field('licence_no'),
      licence_expiry: field('licence_expiry'),
    },
  };
}

export interface DriverApiDeps {
  /** `${SUPABASE_URL}/functions/v1/driver-api`. */
  baseUrl: string;
  /** The publishable key (the apikey header the gateway wants). */
  apiKey: string;
  /** The signed-in session's access token, or null. */
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export function createDriverApi(deps: DriverApiDeps) {
  const doFetch = deps.fetch ?? fetch;

  async function post(path: string, body: unknown, what: string, timeoutMs: number): Promise<unknown> {
    const token = await deps.token();
    if (!token) throw new ApiError(`${what}: not signed in`, false, undefined, 401);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${deps.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: deps.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // No answer (no connection, or it took too long): the same request later.
      throw new ApiError(`${what}: ${error instanceof Error ? error.message : 'no answer'}`, false);
    } finally {
      clearTimeout(timer);
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const kind = answerKind(res.status);
    if (kind === 'ok') return json;
    if (kind === 'refused') throw new ApiError(errorWords(json, res.status), true, 'refused', res.status);
    throw new ApiError(`${what}: ${errorWords(json, res.status)}`, kind === 'failed', undefined, res.status);
  }

  async function trip(path: string, body: unknown, what: string): Promise<TripAnswer> {
    const answer = parseTripAnswer(await post(path, body, what, TRIP_TIMEOUT_MS));
    // An answer with no trip in it: as if none came (the id makes the next try harmless).
    if (!answer) throw new ApiError(`${what}: the answer had no trip`, false);
    return answer;
  }

  return {
    searchPlaces: async (text: string, session?: string | null): Promise<SearchAnswer> =>
      parseSearchAnswer(await post('/places/search', { text, ...(session ? { session } : {}) }, 'search', SEARCH_TIMEOUT_MS)),
    /** An empty box's suggestions (Saved, then the driver's own Recent), nearest to `near` when the phone knows where it is. */
    suggestPlaces: async (near?: { lat: number; lng: number } | null): Promise<SearchAnswer> =>
      parseSearchAnswer(await post('/places/search', { suggest: true, ...(near ? { near } : {}) }, 'suggestions', SEARCH_TIMEOUT_MS)),
    createTrip: (request: TripRequest): Promise<TripAnswer> => trip('/trips', request, 'trip'),
    addTripStop: (taskId: string, request: StopRequest): Promise<TripAnswer> => trip(`/trips/${taskId}/stops`, request, 'trip stop'),
    /** A trip started by mistake, cancelled before it starts (online only: it must be on the server). */
    cancelTrip: (taskId: string): Promise<TripAnswer> => trip(`/trips/${taskId}/cancel`, {}, 'cancel trip'),
    /** Part 3b (G): my profile's changed fields (online only). A rule broken comes back as a refusal in words. */
    saveProfile: async (patch: ProfilePatch): Promise<{ saved: string[]; profile: SavedProfile }> => {
      const answer = parseProfileAnswer(await post('/profile', patch, 'profile', PROFILE_TIMEOUT_MS));
      if (!answer) throw new ApiError('profile: the answer had no profile', false);
      return answer;
    },
  };
}

export type DriverApi = ReturnType<typeof createDriverApi>;
/** What the queue needs from it (tests pass their own). */
export type TripsApi = Pick<DriverApi, 'createTrip' | 'addTripStop'>;
