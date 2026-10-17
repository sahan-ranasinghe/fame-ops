// Small pictures from the private buckets (Phase 7 §5, §6): a vehicle's thumbnail beside its plate (the vehicle
// picker, the task card) and the driver's own photo (Me). A photo still waiting on the phone shows from its file; a
// photo on the server through a 1-hour link the app signs itself (lib/signedUrls.ts). No picture, or no connection:
// a plain placeholder.

import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { User, Van } from '@/components/icons';
import { BUCKETS, fetchPhotoPath } from '@/lib/api';
import { getJson, KEYS } from '@/lib/kv';
import { fileExists } from '@/lib/photos';
import { signedUrl, useSignedUrls } from '@/lib/signedUrls';
import { supabase } from '@/lib/supabase';
import { type KeptProfilePhoto, useApp } from '@/state/app';
import { colors } from '@/theme';

/** A square picture with rounded corners, or the placeholder icon when there is none. */
export function Thumb({ uri, size = 56, round = false, kind = 'vehicle' }: {
  uri: string | null | undefined;
  size?: number;
  round?: boolean;
  kind?: 'vehicle' | 'person';
}) {
  const box = { width: size, height: size, borderRadius: round ? size / 2 : 10 };
  if (uri) return <Image source={{ uri }} style={[styles.thumb, box]} resizeMode="cover" accessibilityIgnoresInvertColors />;
  const Icon = kind === 'person' ? User : Van;
  return (
    <View style={[styles.thumb, styles.empty, box]}>
      <Icon size={Math.round(size * 0.45)} color={colors.muted} />
    </View>
  );
}

/**
 * The thumbnails of these vehicles (vehicle id → picture): the server's photo when it has one, else one taken on this
 * phone that is still waiting to be sent. `again` asks the server again (pull to refresh).
 */
export function useVehicleThumbs(ids: string[], again?: unknown): Record<string, string> {
  const { vehicles, pendingVehiclePhotos } = useApp();
  const paths = ids.map((id) => vehicles.find((v) => v.id === id)?.photo_thumb_path ?? null);
  const urls = useSignedUrls(BUCKETS.vehiclePhotos, paths, again);
  const found: Record<string, string> = {};
  ids.forEach((id, i) => {
    const path = paths[i];
    const uri = (path && urls[path]) || pendingVehiclePhotos[id];
    if (uri) found[id] = uri;
  });
  return found;
}

/** Whether a vehicle still needs its first photo: none on the server (as last read) and none waiting on the phone. */
export function useNeedsVehiclePhoto(): (vehicleId: string) => boolean {
  const { vehicles, pendingVehiclePhotos } = useApp();
  return (vehicleId) => !vehicles.find((v) => v.id === vehicleId)?.photo_path && !pendingVehiclePhotos[vehicleId];
}

/** The driver's own photo: the copy kept on the phone when it is the current one, else a link to the server's. */
export function useMyPhoto(): string | null {
  const { me } = useApp();
  const photoId = me?.photo_id ?? null;
  const kept = getJson<KeptProfilePhoto>(KEYS.profilePhoto);
  const local = kept && photoId && kept.photoId === photoId && fileExists(kept.uri) ? kept.uri : null;
  const [remote, setRemote] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!photoId || local) return;
    let live = true;
    void (async () => {
      try {
        const path = await fetchPhotoPath(supabase, photoId);
        const link = path ? await signedUrl(BUCKETS.driverPhotos, path) : null;
        if (live && link && 'url' in link) setRemote({ id: photoId, url: link.url });
      } catch {
        // No connection: the placeholder until next time.
      }
    })();
    return () => {
      live = false;
    };
  }, [photoId, local]);
  return local ?? (remote && remote.id === photoId ? remote.url : null);
}

const styles = StyleSheet.create({
  thumb: { backgroundColor: colors.mapLand },
  empty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
});
