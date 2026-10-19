// Office mode (Phase 8, O2): the office's location search on the phone (design 06; the site's ui/LocationSearch.tsx):
// from 2 characters it asks search_places (our places, the sites, the places used before, the map's public places) and
// lists them with their badges; a pasted pin or Google Maps link answers a pin; "Search Google" (only under the google
// package, as on the site) asks Google's place search with one session token per typing session, and a pick fetches
// its pin with google_place (the stop keeps the Google id: the server draws it on Google's map only). "My location" for
// a start: the phone's position (a foreground permission asked once). Nothing is saved as one of our places here.

import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ChevronRight, LocateFixed, Search, X } from '@/components/icons';
import { Txt } from '@/components/ui';
import { useOffice } from '@/office/state';
import { badgeTone, DEBOUNCE_MS, type Picked, pickedOf, pinText, shouldSearch } from '@/office/trip/locationLogic';
import type { FleetError, GooglePlaceAnswer, SearchAnswer, SearchResult } from '@/office/types';
import { Pill } from '@/office/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export type { Picked };

export function PlaceSearch({ value, placeholder, onText, onPick, myLocation = false, autoFocus = false }: {
  value: string;
  placeholder: string;
  /** The person typed (the pick, if any, is gone). */
  onText: (text: string) => void;
  onPick: (p: Picked) => void;
  /** Offer the phone's position ("My location"), for a start. */
  myLocation?: boolean;
  autoFocus?: boolean;
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
  const session = useRef<string | null>(null);
  const seq = useRef(0);
  useEffect(() => setText(value), [value]);

  // The search, 300 ms after the last key (the site's DEBOUNCE_MS); Google's layer only when asked for.
  useEffect(() => {
    if (!canSearch || text === value || !shouldSearch(text)) {
      if (!shouldSearch(text)) setAnswer(null);
      return;
    }
    const n = ++seq.current;
    const timer = setTimeout(() => {
      setBusy(true);
      const withGoogle = google && canGoogle;
      if (withGoogle && !session.current) session.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      api.call<SearchAnswer>('search_places', { text, ...(withGoogle ? { google: true, session: session.current } : {}) }).then((a) => {
        if (n !== seq.current) return;
        setAnswer(a);
        setProblem(null);
      }, (e: FleetError) => {
        if (n !== seq.current) return;
        setProblem(e.message);
      }).finally(() => {
        if (n === seq.current) setBusy(false);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, value, google, canSearch, canGoogle, api]);

  async function pick(r: SearchResult) {
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
      onPick({ name: t('office.trip.myLocation'), lat: pos.coords.latitude, lng: pos.coords.longitude, pinned: true });
      setAnswer(null);
    } catch {
      setProblem(t('office.trip.noLocation'));
    } finally {
      setLocating(false);
    }
  }

  const results = answer?.results ?? [];
  const pin = answer?.pin;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.box}>
        <Search size={22} color={colors.muted} />
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            onText(v);
          }}
          placeholder={placeholder}
          placeholderTextColor="#9aa0a6"
          autoFocus={autoFocus}
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel={placeholder}
        />
        {busy ? <ActivityIndicator color={colors.muted} /> : text !== '' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('office.common.cancel')} onPress={() => { setText(''); onText(''); setAnswer(null); }} hitSlop={8} style={styles.clear}>
            <X size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {problem && <Txt variant="small" color={colors.red}>{problem}</Txt>}
      {pin && (
        <Pressable accessibilityRole="button" onPress={() => void pick({ layer: 'map', badge: 'Pin', name: pin.name ?? pinText(pin), lat: pin.lat, lng: pin.lng, pinned: true })} style={styles.row}>
          <Pill text={t('office.trip.thisPin')} tone="amber" />
          <View style={{ flex: 1 }}><Txt variant="strong">{pin.name ?? pinText(pin)}</Txt></View>
          <ChevronRight size={22} color={colors.muted} />
        </Pressable>
      )}
      {results.map((r, i) => (
        <Pressable key={`${r.layer}-${r.id ?? r.google_place_id ?? r.ref ?? i}`} accessibilityRole="button" onPress={() => void pick(r)} style={styles.row}>
          <Pill text={r.badge} tone={badgeTone(r.badge)} />
          <View style={{ flex: 1 }}>
            <Txt variant="strong" numberOfLines={1}>{r.name}</Txt>
            {r.detail ? <Txt variant="small" numberOfLines={1}>{r.detail}</Txt> : null}
          </View>
          <ChevronRight size={22} color={colors.muted} />
        </Pressable>
      ))}
      {answer?.map_note ? <Txt variant="small">{answer.map_note}</Txt> : null}
      {answer && results.some((r) => r.layer === 'google') && <Txt variant="small">{t('office.trip.googleCredit')}</Txt>}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {canGoogle && shouldSearch(text) && !google && (
          <Pressable accessibilityRole="button" onPress={() => setGoogle(true)} style={styles.chip}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.card, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 18, color: colors.ink, paddingVertical: 8 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
});
