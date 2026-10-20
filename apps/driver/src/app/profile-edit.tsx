// Me → Edit (Part 3b, G; docs/phase7-plan.md "Part 3b"), pushed over Me: the driver's mobile number, WhatsApp (only when
// it is not the mobile), the emergency contact (name, relationship, phone), the driving licence (number, expiry
// YYYY-MM-DD, the front and back photos: the camera, 1600 px JPEG ~0.7 like every photo). Save sends only what changed
// (lib/profile.ts profilePatch) to driver-api /profile, which stores the numbers +94… and logs every change for the
// office; then each new licence photo: the file to <employee_id>/licence/<uuid>.jpg, its photos row (kind licence),
// set_my_licence_photo. Online only: with no connection it says so and keeps what was typed. Back with something
// changed asks "Discard changes?"; while it saves, back does nothing; after Save it returns to Me.

import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Camera, ChevronLeft } from '@/components/icons';
import { useLeaveGuard } from '@/components/navigation';
import { DateField } from '@/components/patterns/Calendar';
import { Thumb, useLicencePhotos } from '@/components/Photos';
import { Button, Card, Field, Notice, Txt } from '@/components/ui';
import { type LocalPhoto, removeFile, takePhoto } from '@/lib/photos';
import {
  type LicenceSide,
  licencePhotoId,
  type ProfileForm,
  type ProfilePatch,
  profileDirty,
  profileForm,
  profilePatch,
} from '@/lib/profile';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const SIDES: LicenceSide[] = ['front', 'back'];

export default function ProfileEditScreen() {
  const app = useApp();
  const { t, me } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<ProfileForm>(() => profileForm(me));
  // New licence photos taken here, not saved yet (a side whose photo is on `me` now is saved).
  const [photos, setPhotos] = useState<Partial<Record<LicenceSide, LocalPhoto>>>({});
  const [busy, setBusy] = useState<'save' | 'photo' | null>(null);
  const [problem, setProblem] = useState<{ text: string; field?: keyof ProfilePatch } | null>(null);
  const shown = useLicencePhotos();

  const pending = Object.fromEntries(
    SIDES.flatMap((side) => {
      const photo = photos[side];
      return photo && licencePhotoId(me, side) !== photo.id ? [[side, photo]] : [];
    }),
  ) as Partial<Record<LicenceSide, LocalPhoto>>;
  const dirty = profileDirty(me, form) || Object.keys(pending).length > 0;
  const { allowLeave } = useLeaveGuard(dirty, busy === 'save');

  // A photo taken here and never saved does not stay on the phone.
  const latest = useRef({ photos, me });
  latest.current = { photos, me };
  useEffect(() => () => {
    const { photos: left, me: now } = latest.current;
    for (const side of SIDES) {
      const photo = left[side];
      if (photo && licencePhotoId(now, side) !== photo.id) removeFile(photo.uri);
    }
  }, []);

  if (!me) return <Redirect href="/login" />;

  const set = (field: keyof ProfileForm) => (text: string) => {
    setForm((old) => ({ ...old, [field]: text }));
    if (problem?.field === field) setProblem(null);
  };
  const fieldProblem = (field: keyof ProfilePatch) => (problem?.field === field ? <Notice tone="danger" text={problem.text} /> : null);

  async function take(side: LicenceSide) {
    if (busy) return;
    setProblem(null);
    setBusy('photo');
    let shot: Awaited<ReturnType<typeof takePhoto>> = null;
    try {
      shot = await takePhoto();
    } catch {
      shot = null;
    }
    setBusy(null);
    if (shot === 'denied') {
      setProblem({ text: t('common.cameraDenied') });
      return;
    }
    if (!shot) return;
    const before = photos[side];
    if (before) removeFile(before.uri);
    setPhotos((old) => ({ ...old, [side]: shot }));
  }

  async function save() {
    if (busy) return;
    const { patch, problem: wrong } = profilePatch(me, form);
    if (wrong) {
      setProblem({ text: t(wrong.key), field: wrong.field });
      return;
    }
    if (Object.keys(patch).length === 0 && Object.keys(pending).length === 0) {
      allowLeave();
      router.back();
      return;
    }
    setProblem(null);
    setBusy('save');
    const outcome = await app.saveProfile(patch, pending);
    setBusy(null);
    if (outcome.kind === 'network') {
      setProblem({ text: t('profile.noConnection') });
      return;
    }
    if (outcome.kind === 'refused') {
      setProblem({ text: t('profile.failed', { reason: outcome.message }) });
      return;
    }
    allowLeave();
    Alert.alert(t('profile.saved'), undefined, [{ text: t('common.ok'), onPress: () => router.back() }], { cancelable: false });
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 24, gap: 16 }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <Txt variant="title" size={28} style={{ flex: 1 }}>{t('profile.title')}</Txt>
        </View>
        <Txt variant="muted">{t('profile.officeSees')}</Txt>

        <Card style={{ gap: 14 }}>
          <Field label={t('profile.phone')} value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" mono />
          {fieldProblem('phone')}
          <View style={{ gap: 4 }}>
            <Field label={t('profile.whatsapp')} value={form.whatsapp} onChangeText={set('whatsapp')} keyboardType="phone-pad" mono />
            <Txt variant="small">{t('profile.whatsappHint')}</Txt>
          </View>
          {fieldProblem('whatsapp')}
        </Card>

        <Card style={{ gap: 14 }}>
          <Txt variant="big">{t('profile.emergency')}</Txt>
          <Field label={t('profile.emergencyName')} value={form.emergency_name} onChangeText={set('emergency_name')} autoCapitalize="words" maxLength={120} />
          <Field
            label={t('profile.emergencyRelation')}
            placeholder={t('profile.emergencyRelationHint')}
            value={form.emergency_relation}
            onChangeText={set('emergency_relation')}
            maxLength={60}
          />
          <Field label={t('profile.emergencyPhone')} value={form.emergency_phone} onChangeText={set('emergency_phone')} keyboardType="phone-pad" mono />
          {fieldProblem('emergency_phone')}
        </Card>

        <Card style={{ gap: 14 }}>
          <Txt variant="big">{t('profile.licence')}</Txt>
          <Field label={t('profile.licenceNo')} value={form.licence_no} onChangeText={set('licence_no')} autoCapitalize="characters" maxLength={40} mono />
          <DateField label={t('profile.licenceExpiry')} value={form.licence_expiry} onChange={set('licence_expiry')} testID="profile-licence-expiry" />
          {fieldProblem('licence_expiry')}
          <View style={styles.sides}>
            {SIDES.map((side) => {
              const uri = photos[side]?.uri ?? shown[side];
              return (
                <View key={side} style={styles.side}>
                  <Txt variant="strong" size={16}>{t(side === 'front' ? 'profile.licenceFront' : 'profile.licenceBack')}</Txt>
                  <Thumb uri={uri} size={132} kind="card" />
                  <Button
                    kind="outline"
                    icon={Camera}
                    label={t(uri ? 'profile.changePhoto' : 'profile.addPhoto')}
                    disabled={busy !== null}
                    onPress={() => void take(side)}
                  />
                </View>
              );
            })}
          </View>
        </Card>

        {problem && !problem.field && <Notice tone="danger" text={problem.text} />}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 16 }}>
        <Button label={t(busy === 'save' ? 'profile.saving' : 'profile.save')} busy={busy === 'save'} disabled={busy === 'photo'} onPress={() => void save()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  sides: { flexDirection: 'row', gap: 12 },
  side: { flex: 1, gap: 8, alignItems: 'stretch' },
});
