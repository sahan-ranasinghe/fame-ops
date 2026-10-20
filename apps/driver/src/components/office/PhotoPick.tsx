// Office mode (Stage 1, O3 item 5): the two buttons that get a photo, Take photo (the camera) and Choose from photos (the
// system photo picker), the same everywhere a photo or a document is added (a vehicle, a driver, a licence, a document).
// The picture comes back made at its size (office/media.ts); a camera that is not allowed says so with the way to
// allow it. The caller sends it on.

import { useState } from 'react';
import { Linking, View } from 'react-native';

import { Button, Notice } from '@/components/ui';
import { pickPhoto, type Shot } from '@/office/media';
import type { PhotoUse } from '@/office/mediaLogic';
import { useApp } from '@/state/app';

export function PhotoPick({ use, label, onShot, disabled = false, testID = 'photo-pick' }: {
  use: PhotoUse;
  /** The camera button's words ("Take photo", "Replace photo", "Photograph the front"). */
  label: string;
  onShot: (shot: Shot) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { t } = useApp();
  const [busy, setBusy] = useState<'camera' | 'library' | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function pick(source: 'camera' | 'library') {
    setBusy(source);
    setDenied(false);
    setFailed(false);
    try {
      const shot = await pickPhoto(use, source);
      if (shot === 'denied') setDenied(true);
      else if (shot) onShot(shot);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: 8 }} testID={testID}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button kind="outline" label={label} busy={busy === 'camera'} disabled={disabled || busy !== null} onPress={() => void pick('camera')} style={{ flex: 1, minHeight: 52 }} />
        <Button kind="outline" label={t('office.media.choose')} busy={busy === 'library'} disabled={disabled || busy !== null} onPress={() => void pick('library')} style={{ flex: 1, minHeight: 52 }} />
      </View>
      {denied && (
        <View style={{ gap: 6 }}>
          <Notice tone="danger" text={t('office.media.cameraDenied')} />
          <Button kind="outline" label={t('office.media.openSettings')} onPress={() => void Linking.openSettings()} style={{ minHeight: 48 }} />
        </View>
      )}
      {failed && <Notice tone="danger" text={t('office.media.pickFailed')} />}
    </View>
  );
}
