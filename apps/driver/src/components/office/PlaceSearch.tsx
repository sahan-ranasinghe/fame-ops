// Office mode (Phase 8, O2): the office's location search on the phone (design 06; the site's ui/LocationSearch.tsx):
// from 2 characters it asks search_places (our places, the sites, the places used before, the map's public places) and
// lists them with their badges; a pasted pin or Google Maps link answers a pin; "Search Google" (only under the google
// package, as on the site) asks Google's place search with one session token per typing session, and a pick fetches
// its pin with google_place (the stop keeps the Google id: the server draws it on Google's map only). "My location" for
// a start: the phone's position (a foreground permission asked once). Nothing is saved as one of our places here.
//
// Hotfix O2-H1 (Part A): the search runs after the person typed (a `typed` flag, as the site's box; never for a value a
// pick or the form set, and never skipped because the form already holds the text, which is what hid every result).
// Under the field there is always one of: the results, "Searching…", "No places found", or the error with Try again.
// An empty box shows suggestions from search_places {suggest} (the places used before, our places, the nearest towns),
// nearest to the phone when its position is already allowed (no prompt), else to the base place.

import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ChevronRight, LocateFixed, Search, X } from '@/components/icons';
import { ListError, SkeletonRows } from '@/components/patterns/ListState';
import { Button, Txt } from '@/components/ui';
import { POSITION_TIMEOUT_MS, SUGGEST_TIMEOUT_MS, TimeoutError, withTimeout } from '@/lib/patterns/listLogic';
import { useOffice } from '@/office/state';
import { PinAdjust } from './PinAdjust';
import { badgeTone, DEBOUNCE_MS, looksPasted, type Picked, pickedOf, pinText, searchState, shouldSearch, suggestArgs } from '@/office/trip/locationLogic';
import type { FleetError, GooglePlaceAnswer, SearchAnswer, SearchResult } from '@/office/types';
import { Pill } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors, webInnerInput } from '@/theme';

export type { Picked };

type Suggest = { answer: SearchAnswer | null; busy: boolean; failed: boolean };

export function PlaceSearch({ value, placeholder, onText, onPick, myLocation = false, autoFocus = false, editing = false }: {
  value: string;
  placeholder: string;
  /** The person typed (the pick, if any, is gone). */
  onText: (text: string) => void;
  onPick: (p: Picked) => void;
  /** Offer the phone's position ("My location"), for a start. */
  myLocation?: boolean;
  autoFocus?: boolean;
  /** Opened with Change: the previous text is selected, so typing replaces it (Hotfix O2-H1). */
  editing?: boolean;
}) {
  const { t } = useApp();
  const { api, me } = useOffice();
  const canSearch = me.tools.includes('search_places');
  const canGoogle = !!me.map?.places && me.tools.includes('google_place');
  const [text, setText] = useState(value);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [retry, setRetry] = useState(0);
  const [suggest, setSuggest] = useState<Suggest>({ answer: null, busy: false, failed: false });
  // O3 row 8: a pasted pin is checked on the map first (PinAdjust: move the map under the fixed pin, Use this point).
  const [pinCheck, setPinCheck] = useState<{ name: string; lat: number; lng: number; n: number } | null>(null);
  const session = useRef<string | null>(null);
  const seq = useRef(0);
  /** The person typed since the last pick: only then the box asks (the site's rule). */
  const typed = useRef(false);
  useEffect(() => setText(value), [value]);

  // The search, 300 ms after the last key (a pasted pin at once); Google's layer only when asked for.
  useEffect(() => {
    if (!canSearch || !typed.current) return;
    if (!shouldSearch(text)) {
      setAnswer(null);
      setProblem(null);
      return;
    }
    const n = ++seq.current;
    const timer = setTimeout(() => {
      setBusy(true);
      setProblem(null);
      const withGoogle = google && canGoogle;
      if (withGoogle && !session.current) session.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      withTimeout(api.call<SearchAnswer>('search_places', { text: text.trim(), ...(withGoogle ? { google: true, session: session.current } : {}) }), SUGGEST_TIMEOUT_MS).then((a) => {
        if (n !== seq.current) return;
        setAnswer(a);
        setProblem(null);
      }, (e: FleetError | Error) => {
        if (n !== seq.current) return;
        setAnswer(null);
        // A timeout in the person's language (TimeoutError's own words are English); the server's sentence otherwise.
        setProblem(e instanceof TimeoutError || (e as FleetError).code === 'timeout' ? t('patterns.suggestionsTimeout') : e.message || t('patterns.suggestionsTimeout'));
      }).finally(() => {
        if (n === seq.current) setBusy(false);
      });
    }, looksPasted(text) ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, google, canSearch, canGoogle, api, retry]);

  // Suggestions for an empty box, loaded once per box: the phone's position when it is already allowed (no prompt; 3 s at
  // most), else the server's base place. Stage 0 fix: the effect used to depend on its own "busy" flag, so setting it
  // re-ran the effect and its cleanup threw the answer away, and the box said "Loading" for ever. Now one call, a
  // sequence number for the latest, a 15 s timeout, and the error with Try again (docs/ui-patterns.md §5).
  const empty = !shouldSearch(text);
  const suggestSeq = useRef(0);
  const [suggestTry, setSuggestTry] = useState(0);
  // Stage 0 review: only a box that is (or becomes) empty asks, once (Try again asks again): a trip of 12 stops that all
  // hold a place makes no calls at all.
  const wantSuggest = canSearch && empty;
  const asked = useRef(-1);
  useEffect(() => {
    if (!wantSuggest || asked.current === suggestTry) return;
    asked.current = suggestTry;
    const n = ++suggestSeq.current;
    setSuggest({ answer: null, busy: true, failed: false });
    void (async () => {
      let near: { lat: number; lng: number } | null = null;
      try {
        const perm = await withTimeout(Location.getForegroundPermissionsAsync(), POSITION_TIMEOUT_MS);
        if (perm.granted) {
          const pos = await withTimeout(Location.getLastKnownPositionAsync(), POSITION_TIMEOUT_MS);
          if (pos) near = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
      } catch {
        near = null;
      }
      try {
        const a = await withTimeout(api.call<SearchAnswer>('search_places', suggestArgs(near)), SUGGEST_TIMEOUT_MS);
        if (n === suggestSeq.current) setSuggest({ answer: a, busy: false, failed: false });
      } catch {
        if (n === suggestSeq.current) setSuggest({ answer: null, busy: false, failed: true });
      }
    })();
  }, [wantSuggest, api, suggestTry]);

  async function pick(r: SearchResult) {
    typed.current = false;
    if (r.layer === 'google' && r.google_place_id) {
      setBusy(true);
      try {
        const g = await api.call<GooglePlaceAnswer>('google_place', { google_place_id: r.google_place_id, ...(session.current ? { session: session.current } : {}) });
        session.current = null;
        onPick({ name: r.name, googlePlaceId: g.google_place_id, lat: g.lat, lng: g.lng, pinned: true });
      } catch (e) {
        setProblem((e as FleetError).message);
      } finally {
        setBusy(false);
      }
    } else {
      onPick(pickedOf(r));
    }
    setAnswer(null);
    setGoogle(false);
  }

  async function locate() {
    setLocating(true);
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      const granted = perm.granted || (await Location.requestForegroundPermissionsAsync()).granted;
      if (!granted) {
        setProblem(t('office.trip.noLocationPermission'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      typed.current = false;
      onPick({ name: t('office.trip.myLocation'), lat: pos.coords.latitude, lng: pos.coords.longitude, pinned: true });
      setAnswer(null);
    } catch {
      setProblem(t('office.trip.noLocation'));
    } finally {
      setLocating(false);
    }
  }

  const state = searchState({ searchable: !empty && typed.current, busy, answer, problem });
  const results = answer?.results ?? [];
  const pin = answer?.pin;
  const badgeText = (r: SearchResult) => (r.layer === 'town' ? t('office.trip.townBadge') : r.badge);
  const row = (r: SearchResult, i: number) => (
    <Pressable key={`${r.layer}-${r.id ?? r.google_place_id ?? r.ref ?? r.name}-${i}`} accessibilityRole="button" onPress={() => void pick(r)} style={styles.row}>
      <Pill text={badgeText(r)} tone={badgeTone(r.badge)} />
      <View style={{ flex: 1 }}>
        <Txt variant="strong" numberOfLines={1}>{r.name}</Txt>
        {r.detail ? <Txt variant="small" numberOfLines={1}>{r.detail}</Txt> : null}
      </View>
      <ChevronRight size={22} color={colors.muted} />
    </Pressable>
  );

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.box}>
        <Search size={22} color={colors.muted} />
        <TextInput
          value={text}
          onChangeText={(v) => {
            typed.current = true;
            setText(v);
            onText(v);
          }}
          placeholder={placeholder}
          placeholderTextColor="#9aa0a6"
          autoFocus={autoFocus}
          selectTextOnFocus={editing}
          autoCorrect={false}
          style={[styles.input, webInnerInput]}
          accessibilityLabel={placeholder}
        />
        {busy ? <ActivityIndicator color={colors.muted} /> : text !== '' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.cancel')} onPress={() => { typed.current = false; setText(''); onText(''); setAnswer(null); setProblem(null); }} hitSlop={8} style={styles.clear}>
            <X size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {state === 'searching' && <SkeletonRows rows={3} lines={2} testID="place-search-searching" />}
      {state === 'error' && (
        <View style={{ gap: 8 }} testID="place-search-error">
          <Txt variant="strong" size={15} color={colors.red}>{problem}</Txt>
          <Button kind="outline" label={t('office.common.tryAgain')} onPress={() => { setProblem(null); setRetry((n) => n + 1); }} style={{ minHeight: 48 }} />
        </View>
      )}
      {state === 'none' && <Txt variant="muted" size={15} testID="place-search-none">{t('office.trip.noPlaces')}</Txt>}
      {state === 'results' && pin && (
        <Pressable accessibilityRole="button" onPress={() => setPinCheck({ name: pin.name ?? pinText(pin), lat: pin.lat, lng: pin.lng, n: (pinCheck?.n ?? 0) + 1 })} style={styles.row} testID="place-search-pin">
          <Pill text={t('office.trip.thisPin')} tone="amber" />
          <View style={{ flex: 1 }}><Txt variant="strong">{pin.name ?? pinText(pin)}</Txt></View>
          <ChevronRight size={22} color={colors.muted} />
        </Pressable>
      )}
      {state === 'results' && results.map(row)}
      {state === 'results' && answer?.map_note ? <Txt variant="small">{answer.map_note}</Txt> : null}
      {state === 'results' && results.some((r) => r.layer === 'google') && <Txt variant="small">{t('office.trip.googleCredit')}</Txt>}
      {problem && state !== 'error' ? <Txt variant="small" color={colors.red}>{problem}</Txt> : null}

      {empty && canSearch && (
        <View style={{ gap: 4 }} testID="place-search-suggestions">
          {suggest.busy && <SkeletonRows rows={3} lines={2} testID="place-search-skeleton" />}
          {suggest.failed && <ListError message={t('office.trip.suggestionsFailed')} onRetry={() => setSuggestTry((n) => n + 1)} />}
          {suggest.answer && suggest.answer.results.length > 0 && (
            <>
              <Txt variant="label" color={colors.muted}>{t('office.trip.suggestions').toUpperCase()}</Txt>
              {suggest.answer.results.map(row)}
            </>
          )}
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {canGoogle && !empty && !google && (
          <Pressable accessibilityRole="button" onPress={() => { typed.current = true; setGoogle(true); }} style={styles.chip}>
            <Txt variant="strong" size={15}>{t('office.trip.searchGoogle')}</Txt>
          </Pressable>
        )}
        {myLocation && (
          <Pressable accessibilityRole="button" onPress={() => void locate()} disabled={locating} style={styles.chip}>
            {locating ? <ActivityIndicator color={colors.ink} /> : <LocateFixed size={18} color={colors.ink} />}
            <Txt variant="strong" size={15}>{t('office.trip.myLocation')}</Txt>
          </Pressable>
        )}
      </View>
      <PinAdjust
        key={pinCheck?.n ?? 0}
        visible={pinCheck !== null}
        pin={pinCheck}
        name={pinCheck?.name ?? ''}
        mapPackage={me.map?.package}
        onClose={() => setPinCheck(null)}
        onUse={(p) => {
          // A pin moved on the map is named by its new point (the pasted text named the old one).
          const moved = !!pinCheck && (Math.abs(p.lat - pinCheck.lat) > 1e-5 || Math.abs(p.lng - pinCheck.lng) > 1e-5);
          const name = moved ? pinText(p) : pinCheck?.name ?? '';
          setPinCheck(null);
          void pick({ layer: 'map', badge: 'Pin', name, lat: p.lat, lng: p.lng, pinned: true });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.card, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 18, color: colors.ink, paddingVertical: 8 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
});
