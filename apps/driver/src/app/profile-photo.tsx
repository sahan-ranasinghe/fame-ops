// "Add your photo" (Phase 7 §5): the step after Permissions while the driver has no photo (the tabs send the driver
// here, lib/photoRules.ts needsProfilePhoto), and Change photo from Me (mode=change). Take photo (the front camera)
// or Choose from gallery, both through the square crop screen; the photo is saved at once, not queued. No skip: on a
// failure the reason in words, Try again (the same photo) and both buttons. The step replaces the tabs, like Login and
// Permissions (back puts the app in the background); from Me it is pushed and back returns to Me.

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Camera, ChevronLeft, Images, RefreshCw } from '@/components/icons';
import { useLeaveGuard } from '@/components/navigation';
import { Thumb, useMyPhoto } from '@/components/Photos';
import { Button, Notice, Txt } from '@/components/ui';
import { type LocalProfilePhoto, pickProfilePhoto, removeFile } from '@/lib/photos';
import { deferProfilePhoto, FAILS_BEFORE_LATER } from '@/lib/photoRules';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function ProfilePhotoScreen() {
  const app = useApp();
  const { t, me } = app;
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const change = mode === 'change';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const current = useMyPhoto();
  // The photo being saved (kept after a failure, so Try again sends the same one).
  const [photo, setPhoto] = useState<LocalProfilePhoto | null>(null);
  const [busy, setBusy] = useState<'pick' | 'save' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const saved = useRef(false);
  const photoRef = useRef(photo);
  // Failures in a row (the camera or the gallery not opening, the photo not saving; not a cancel): twice brings "Not now".
  const fails = useRef(0);
  const [stuck, setStuck] = useState(false);
  const countFailure = () => {
    fails.current += 1;
    if (fails.current >= FAILS_BEFORE_LATER) setStuck(true);
  };
  photoRef.current = photo;
  // Back does nothing while the photo is being saved.
  const { allowLeave } = useLeaveGuard(false, busy === 'save');

  // The first-run step ends as soon as the driver has a photo (saved here, or set meanwhile by the office).
  const hasPhoto = !!me?.photo_id;
  useEffect(() => {
    if (!change && hasPhoto) router.replace('/');
  }, [change, hasPhoto, router]);

  // A photo that was never saved does not stay on the phone.
  useEffect(() => () => {
    if (!saved.current) removeFile(photoRef.current?.uri);
  }, []);

  if (!me) return <Redirect href="/login" />;

  async function save(next: LocalProfilePhoto) {
    setProblem(null);
    setBusy('save');
    const outcome = await app.saveProfilePhoto(next);
    setBusy(null);
    if (outcome !== 'ok') {
      countFailure();
      setProblem(outcome === 'network' ? 'profilePhoto.noConnection' : 'profilePhoto.failed');
      return;
    }
    saved.current = true;
    allowLeave();
    // First run: the effect above leaves once the photo is on `me`.
    if (change) router.back();
  }

  async function pick(source: 'camera' | 'gallery') {
    if (busy) return;
    setProblem(null);
    setBusy('pick');
    let picked: Awaited<ReturnType<typeof pickProfilePhoto>>;
    try {
      picked = await pickProfilePhoto(source);
    } catch {
      picked = null;
      countFailure();
      setProblem('profilePhoto.pickerFailed');
    }
    setBusy(null);
    if (picked === 'denied') {
      setProblem('common.cameraDenied');
      return;
    }
    if (!picked) return;
    // A new photo replaces one that could not be saved.
    if (photo) removeFile(photo.uri);
    setPhoto(picked);
    await save(picked);
  }

  const shown = photo?.uri ?? current;
  const failed = problem !== null && photo !== null && problem !== 'common.cameraDenied';

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 24, gap: 16 }}>
        <View style={styles.header}>
          {change && (
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
              <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
            </Pressable>
          )}
          <Txt variant="title" size={change ? 28 : 30} style={{ flex: 1 }}>{t(change && hasPhoto ? 'profilePhoto.change' : 'profilePhoto.title')}</Txt>
        </View>
        {!change && <Txt variant="muted" size={17}>{t('profilePhoto.body')}</Txt>}

        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          <Thumb uri={shown} size={200} round kind="person" />
          {!shown && <Txt variant="muted" style={{ marginTop: 10 }}>{t('profilePhoto.none')}</Txt>}
        </View>

        {busy === 'save' && <Txt variant="strong" style={{ textAlign: 'center' }}>{t('profilePhoto.saving')}</Txt>}
        {problem && <Notice tone="danger" text={t(problem)} />}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 16, gap: 10 }}>
        {failed && photo && (
          <Button label={t('profilePhoto.tryAgain')} icon={RefreshCw} busy={busy === 'save'} onPress={() => void save(photo)} />
        )}
        <Button
          kind={failed ? 'dark' : 'primary'}
          label={t('profilePhoto.take')}
          icon={Camera}
          disabled={busy !== null}
          busy={busy === 'save' && !failed}
          onPress={() => void pick('camera')}
        />
        <Button kind="outline" label={t('profilePhoto.choose')} icon={Images} disabled={busy !== null} onPress={() => void pick('gallery')} />
        {!change && stuck && (
          <Button
            kind="outline"
            label={t('profilePhoto.later')}
            disabled={busy !== null}
            onPress={() => {
              deferProfilePhoto();
              allowLeave();
              router.replace('/');
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
