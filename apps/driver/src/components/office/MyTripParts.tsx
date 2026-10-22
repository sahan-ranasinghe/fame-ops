// Office mode and /m/ (Round 4–7, feature 4): the pieces of a trip nobody drives with the app, shared by its page
// (app/office/my-trip/[id].tsx) and its two steps (check.tsx, finish.tsx): the trip in one card (the vehicle, when, who
// drives with Call for someone else, the stops), what it already has (the check, the start, the end), and the photo tiles
// with their upload (the camera or the phone's photos through the shared PhotoPick, made at 1600 px, straight into the
// person's own folder: office/myPhoto.ts saveMyTripPhoto; the screen keeps each new photo's id for the tool).

import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { TaskDriverCard } from '@/components/office/DriverRows';
import { PhotoPick } from '@/components/office/PhotoPick';
import { look } from '@/components/patterns/look';
import { RouteStepper } from '@/components/patterns/RouteStepper';
import { Mono, Notice, Plate, Txt } from '@/components/ui';
import { whatsappLink } from '@/lib/contacts';
import { type Shot } from '@/office/media';
import { saveMyTripPhoto, type TripPhotoKind } from '@/office/myPhoto';
import { plateOfTrip, tripFacts } from '@/office/myTripLogic';
import { useOffice } from '@/office/state';
import type { MyTrip } from '@/office/types';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';

/** A photo that is up: its id for the tool and the picture on this phone. */
export interface UpPhoto {
  id: string;
  uri: string;
}

const STOP_KEY: Record<string, string> = { pickup: 'office.trip.type_pickup', drop: 'office.trip.type_drop', visit: 'office.trip.type_visit' };

/** The trip in one card: the plate, leave and back by, who drives (Call someone else), the stops. */
export function TripCard({ trip }: { trip: MyTrip }) {
  const { t } = useApp();
  const { me } = useOffice();
  const plate = plateOfTrip(trip);
  const digits = (trip.driver_phone ?? '').replace(/\D/g, '');
  return (
    <View style={styles.card} testID="my-trip-card">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {trip.vehicle ? <Plate regNo={trip.vehicle} /> : plate ? <Txt variant="strong">{plate}</Txt> : null}
        <Mono size={15} color={colors.muted}>{trip.back_by ? t('office.myTrip.leaveBack', { leave: trip.leave_at, back: trip.back_by }) : t('office.myTrip.leave', { leave: trip.leave_at })}</Mono>
      </View>
      {trip.vehicle_label && trip.vehicle_label !== trip.vehicle ? <Txt variant="muted" size={15}>{trip.vehicle_label}</Txt> : null}
      <TaskDriverCard
        name={trip.driven_by === 'other' ? trip.driver_name : me.name}
        drivenBy={trip.driven_by}
        call={trip.driven_by === 'other' && digits ? `tel:+${digits.startsWith('0') ? `94${digits.slice(1)}` : digits}` : undefined}
        whatsapp={trip.driven_by === 'other' ? whatsappLink(trip.driver_phone) ?? undefined : undefined}
        emptyName={t('office.who.someoneElse')}
      />
      {/* Round 4–7, item 12: the stops on the route stepper (the type under the place), the planned km under them. */}
      {trip.stops.length > 0 && (
        <View style={{ gap: 4 }}>
          <RouteStepper framed={false} compact testID="my-trip-stepper" rows={trip.stops.map((s) => ({ key: String(s.n), mark: String(s.n), kind: 'stop' as const, title: s.place, titleLines: 2 as const, meta: STOP_KEY[s.type] ? [{ text: t(STOP_KEY[s.type]) }] : undefined }))} />
          {trip.planned_km ? <Txt variant="small">{t('office.myTrip.plannedKm', { km: trip.planned_km })}</Txt> : null}
        </View>
      )}
      {tripFacts(trip).map((f) => <Txt key={f.key} variant="small" testID="my-trip-fact">{t(f.key, f.vars)}</Txt>)}
    </View>
  );
}

/** Photos going up: how many are on their way, the last failure, and `add` (the upload, then `put` with the id). */
export function useTripPhotos(): {
  uploading: number;
  failed: 'failed' | 'network' | null;
  add: (kind: TripPhotoKind, shot: Shot, put: (p: UpPhoto) => void) => Promise<void>;
} {
  const [uploading, setUploading] = useState(0);
  const [failed, setFailed] = useState<'failed' | 'network' | null>(null);
  async function add(kind: TripPhotoKind, shot: Shot, put: (p: UpPhoto) => void) {
    setUploading((n) => n + 1);
    setFailed(null);
    const out = await saveMyTripPhoto(kind, shot.photo.uri);
    if (typeof out === 'string') setFailed(out);
    else put({ id: out.id, uri: shot.photo.uri });
    setUploading((n) => Math.max(0, n - 1));
  }
  return { uploading, failed, add };
}

/** A failed upload in words (the person takes the photo again). */
export function PhotoFailed({ failed }: { failed: 'failed' | 'network' | null }) {
  const { t } = useApp();
  if (!failed) return null;
  return <Notice tone="danger" text={t(failed === 'network' ? 'office.myTrip.photoNetwork' : 'office.myTrip.photoFailed')} />;
}

/** A photo that is up, small, with its label; a tap removes it (it is not used until the step is sent). */
export function PhotoTile({ photo, label, onRemove }: { photo: UpPhoto; label: string; onRemove: () => void }) {
  const { t } = useApp();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('office.myTrip.removePhoto', { what: label })} onPress={onRemove} style={(state) => [styles.tile, hoverStyle(state), state.pressed && { opacity: 0.7 }]} testID="photo-tile">
      <Image source={{ uri: photo.uri }} style={styles.tileImage} accessibilityLabel={label} />
      <Txt variant="small" numberOfLines={1}>{label}</Txt>
      <Txt variant="strong" size={13} color={colors.red}>{t('office.myTrip.remove')}</Txt>
    </Pressable>
  );
}

/** An empty place for a photo still to take (a side of the vehicle). */
export function EmptyTile({ label, next }: { label: string; next: boolean }) {
  return (
    <View style={[styles.tile, styles.emptyTile, next && { borderColor: colors.blue }]}>
      <View style={[styles.tileImage, { alignItems: 'center', justifyContent: 'center' }]}>
        <Txt variant="strong" size={14} color={next ? colors.blue : colors.muted}>{label}</Txt>
      </View>
    </View>
  );
}

/** The shared Take photo / Choose from photos for a trip's photo (made at 1600 px). */
export function TripPhotoPick({ label, onShot, disabled, testID }: { label: string; onShot: (shot: Shot) => void; disabled?: boolean; testID?: string }) {
  return <PhotoPick use="check" label={label} onShot={onShot} disabled={disabled} testID={testID} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: look.border, borderWidth: 1, borderRadius: look.radius, padding: 14, gap: 12 },
  tile: { width: 100, gap: 4, alignItems: 'flex-start' },
  emptyTile: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 10, padding: 4 },
  tileImage: { width: 92, height: 69, borderRadius: 8, backgroundColor: colors.mapLand },
});
