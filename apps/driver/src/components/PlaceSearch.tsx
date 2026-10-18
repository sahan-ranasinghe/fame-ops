// The destination search box of Start a trip and Add a stop (Phase 7 §13). driver-api answers in the office's three
// layers: our places first (with their badges), used before, then the map's (Google's under the google package, with
// the credit "Google Maps" under each of its results). A pasted "lat, lng" or Google Maps link answers a pin. The typed
// words are always a choice ("Go to “…”").
// It asks from 2 characters, 300 ms after the last key (never one request per key press), with one session token per
// typing session; a Google pick carries that token to the trip that ends the session.
// With no connection (or when the search gets no answer) it says so and offers only what works offline: our places
// the phone knows (lib/trips.ts offlineMatches) and the typed words.

import * as Crypto from 'expo-crypto';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { GoogleCredit } from '@/components/GoogleCredit';
import { Check, MapPin } from '@/components/icons';
import { Card, Mono, Notice, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { driverApi } from '@/lib/driverApiClient';
import {
  type Choice,
  type KnownPlace,
  offlineMatches,
  pickFromKnown,
  pickFromPin,
  pickFromResult,
  pickFromText,
  type SearchAnswer,
  SEARCH_DEBOUNCE_MS,
  type SearchResult,
  shouldSearch,
} from '@/lib/trips';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

type Status = 'idle' | 'searching' | 'done' | 'offline';

interface Props {
  /** The phone has a data connection (app.dataAvailable). */
  online: boolean;
  /** Our places the phone knows (app.knownPlaces), for no connection. */
  known: KnownPlace[];
  pick: Choice | null;
  onPick: (pick: Choice | null) => void;
  /** What is typed in the box (the screen's "Discard changes?" looks at it). */
  text: string;
  onTextChange: (text: string) => void;
}

const GROUPS: { layers: SearchResult['layer'][]; title: string }[] = [
  { layers: ['place'], title: 'trip.ours' },
  { layers: ['recent'], title: 'trip.usedBefore' },
  { layers: ['map', 'google'], title: 'trip.map' },
];

export function PlaceSearch({ online, known, pick, onPick, text, onTextChange }: Props) {
  const { t, language } = useApp();
  const [status, setStatus] = useState<Status>('idle');
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  // One token per typing session in this box; a pick ends the session (the next typing starts a new one).
  const session = useRef<string | null>(null);
  // Only the newest request's answer is shown.
  const asked = useRef(0);

  useEffect(() => {
    if (pick) return;
    if (!shouldSearch(text)) {
      setAnswer(null);
      setStatus('idle');
      return;
    }
    if (!online) {
      setStatus('offline');
      return;
    }
    const timer = setTimeout(() => {
      const n = ++asked.current;
      session.current ??= Crypto.randomUUID();
      setStatus('searching');
      driverApi.searchPlaces(text.trim(), session.current).then(
        (found) => {
          if (n !== asked.current) return;
          setAnswer(found);
          setStatus('done');
        },
        (error) => {
          if (n !== asked.current) return;
          // No answer: the phone's own list. A refusal (should not happen): nothing found, the typed words still work.
          setAnswer(null);
          setStatus(error instanceof ApiError && error.permanent ? 'done' : 'offline');
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, online, pick]);

  function choose(next: Choice) {
    session.current = null;
    onPick(next);
  }

  const typed = shouldSearch(text) ? pickFromText(text) : null;
  const local = status === 'offline' ? offlineMatches(text, known) : [];
  const results = status === 'done' ? answer?.results ?? [] : [];
  const pin = status === 'done' ? answer?.pin : undefined;
  const nothing = status === 'done' && results.length === 0 && !pin;

  return (
    <View style={{ gap: 12 }}>
      <Txt variant="big">{t('trip.where')}</Txt>
      <TextInput
        value={text}
        onChangeText={(next) => {
          onTextChange(next);
          if (pick) onPick(null);
        }}
        placeholder={t('trip.searchHint')}
        placeholderTextColor="#9aa0a6"
        autoCorrect={false}
        maxLength={500}
        returnKeyType="search"
        style={[styles.input, { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }]}
      />

      {pick ? (
        <Card style={styles.picked}>
          <View style={styles.pickedIcon}><Check size={20} color={colors.blue} strokeWidth={3} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            {pick.layer === 'pin' ? <Mono size={18} bold>{pick.name}</Mono> : <Txt variant="strong" size={18}>{pick.name}</Txt>}
            <GoogleCredit show={pick.googlePlaceId !== null} />
            {pick.detail && <Txt variant="small" numberOfLines={2}>{pick.detail}</Txt>}
          </View>
          {pick.badge && <Badge text={pick.badge} />}
          <Pressable accessibilityRole="button" onPress={() => onPick(null)} hitSlop={8} style={styles.change}>
            <Txt variant="strong" size={15} color={colors.blue}>{t('today.change')}</Txt>
          </Pressable>
        </Card>
      ) : (
        <>
          {status === 'offline' && <Notice tone="warn" text={t('trip.offlineOnly')} />}
          {status === 'searching' && (
            <View style={styles.searching}>
              <ActivityIndicator color={colors.ink} />
              <Txt variant="muted">{t('trip.searching')}</Txt>
            </View>
          )}

          {local.length > 0 && (
            <Group title={t('trip.ours')}>
              {local.map((place, i) => (
                <Row key={place.id} first={i === 0} title={place.name} detail={[place.site_id, place.address].filter(Boolean).join(' · ')} onPress={() => choose(pickFromKnown(place))} />
              ))}
            </Group>
          )}

          {pin && (
            <Card style={{ padding: 0 }}>
              <Row first mono title={`${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`} onPress={() => choose(pickFromPin(pin))} />
            </Card>
          )}

          {GROUPS.map((group) => {
            const rows = results.filter((r) => group.layers.includes(r.layer));
            if (rows.length === 0) return null;
            return (
              <Group key={group.title} title={t(group.title)}>
                {rows.map((r, i) => (
                  <Row
                    key={`${r.layer}-${r.id ?? r.google_place_id ?? `${r.name}-${i}`}`}
                    first={i === 0}
                    title={r.name}
                    detail={r.detail}
                    badge={r.badge}
                    google={r.layer === 'google'}
                    onPress={() => choose(pickFromResult(r, session.current))}
                  />
                ))}
                {/* The map search's public places carry their credit (OpenStreetMap · openrouteservice), as in the office. */}
                {group.layers.includes('map') && rows.some((r) => r.layer === 'map' && r.attribution) && (
                  <Txt variant="small" color={colors.muted} style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
                    {rows.find((r) => r.layer === 'map' && r.attribution)?.attribution}
                  </Txt>
                )}
              </Group>
            );
          })}
          {status === 'done' && answer?.map_note && <Txt variant="small">{answer.map_note}</Txt>}
          {nothing && <Txt variant="muted">{t('trip.noResults')}</Txt>}

          {typed && (
            <Card style={{ padding: 0 }}>
              <Row first icon title={t('trip.typed', { text: typed.name })} onPress={() => choose(typed)} />
            </Card>
          )}
        </>
      )}
    </View>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="label" color={colors.muted} style={{ marginLeft: 6 }}>{title}</Txt>
      <Card style={{ padding: 0 }}>{children}</Card>
    </View>
  );
}

function Row({ title, detail, badge, google = false, mono = false, icon = false, first, onPress }: {
  title: string;
  detail?: string | null;
  badge?: string | null;
  google?: boolean;
  mono?: boolean;
  icon?: boolean;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, !first && styles.divider, pressed && { backgroundColor: colors.page }]}>
      {(icon || mono) && <MapPin size={20} color={colors.ink} />}
      <View style={{ flex: 1, gap: 2 }}>
        {mono ? <Mono size={17} bold>{title}</Mono> : <Txt variant="strong">{title}</Txt>}
        {/* Google's places carry Google's credit under their name (Google's terms). */}
        <GoogleCredit show={google} />
        {detail ? <Txt variant="small" numberOfLines={2}>{detail}</Txt> : null}
      </View>
      {badge ? <Badge text={badge} /> : null}
    </Pressable>
  );
}

/** The server's badge (Office, Site · Dialog, Saved, Map, Google): data from the office's search, as the office's box shows it. */
function Badge({ text }: { text: string }) {
  return (
    <View style={styles.badge}>
      <Txt variant="small" size={12} color={colors.ink} accessibilityLanguage="en">{text}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 60,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 19,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  searching: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 64 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  badge: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: colors.blue, borderWidth: 2, backgroundColor: colors.blueChip },
  pickedIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  change: { minHeight: 40, justifyContent: 'center', paddingLeft: 4 },
});
