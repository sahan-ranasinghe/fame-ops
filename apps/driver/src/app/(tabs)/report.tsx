// Report tab: tell the office about a problem with the vehicle (what happened,
// a note, 1 to 3 photos), and see the status of earlier reports.

import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Camera, X } from '@/components/icons';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDateLabel } from '@/components/task';
import { Button, Card, Notice, Plate, Txt } from '@/components/ui';
import { discardPhoto, type LocalPhoto, takePhoto } from '@/lib/photos';
import { colomboTime } from '@/lib/time';
import type { ReportCategory } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const CATEGORIES: ReportCategory[] = ['breakdown', 'accident', 'tyre', 'warning_light', 'other'];
const MAX_PHOTOS = 3;
const STATUS_COLOR: Record<string, { text: string; background: string }> = {
  open: { text: colors.red, background: '#fbeceb' },
  in_garage: { text: colors.amberText, background: '#fdf1d6' },
  closed: { text: colors.muted, background: '#eceae4' },
};

export default function ReportScreen() {
  const app = useApp();
  const { t, language, vehicle, reports } = app;
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const insets = useSafeAreaInsets();
  const dateLabel = useDateLabel();

  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function addPhoto() {
    const shot = await takePhoto();
    if (shot === 'denied') return setProblem(t('common.cameraDenied'));
    if (shot) setPhotos((list) => [...list, shot].slice(0, MAX_PHOTOS));
  }

  function removePhoto(photo: LocalPhoto) {
    discardPhoto(photo);
    setPhotos((list) => list.filter((item) => item.id !== photo.id));
  }

  function send() {
    if (!vehicle) return setProblem(t('log.needVehicle'));
    if (!category) return setProblem(t('report.needCategory'));
    if (photos.length === 0) return setProblem(t('report.needPhoto'));
    // A report made from a task screen is linked to that task, if it is still running.
    const running = app.tasks.find((task) => task.status === 'in_progress');
    app.sendReport(category, note, photos, taskId && running?.id === taskId ? taskId : running?.id ?? null);
    setCategory(null);
    setNote('');
    setPhotos([]);
    setProblem(null);
    setSent(true);
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 28, gap: 16 }}>
        <Txt variant="title">{t('report.title')}</Txt>

        <Card style={{ gap: 16 }}>
          <View style={styles.between}>
            <Txt variant="strong">{t('report.vehicle')}</Txt>
            {vehicle ? <Plate regNo={vehicle.reg_no} /> : <Txt variant="muted">{t('today.noVehicle')}</Txt>}
          </View>

          <View style={{ gap: 10 }}>
            <Txt variant="big">{t('report.what')}</Txt>
            <View style={styles.chips}>
              {CATEGORIES.map((item) => {
                const on = item === category;
                return (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => { setCategory(item); setProblem(null); setSent(false); }}
                    style={[styles.chip, on && { backgroundColor: colors.ink, borderColor: colors.ink }]}
                  >
                    <Txt variant="strong" color={on ? '#ffffff' : colors.ink}>{t(`report.${item}`)}</Txt>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Txt variant="strong">{t('report.note')}</Txt>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={500}
              placeholder={t('report.notePlaceholder')}
              placeholderTextColor="#9aa0a6"
              style={[styles.note, { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }]}
            />
          </View>

          <View style={{ gap: 10 }}>
            <Txt variant="strong">{t('report.photos', { n: photos.length })}</Txt>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {photos.map((photo) => (
                <View key={photo.id}>
                  <Image source={{ uri: photo.uri }} style={styles.photo} />
                  <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => removePhoto(photo)} style={styles.remove}>
                    <X size={18} color="#ffffff" strokeWidth={3} />
                  </Pressable>
                </View>
              ))}
              {photos.length < MAX_PHOTOS && (
                <Pressable accessibilityRole="button" accessibilityLabel={t('report.addPhoto')} onPress={addPhoto} style={[styles.photo, styles.addPhoto]}>
                  <Camera size={28} color={colors.ink} />
                </Pressable>
              )}
            </View>
          </View>

          {problem && <Notice tone="danger" text={problem} />}
          {sent && <Notice tone="info" text={t(app.offline ? 'common.savedOffline' : 'report.sent')} />}
          <Button label={t('report.send')} onPress={send} />
        </Card>

        <View style={{ gap: 10 }}>
          <Txt variant="heading" style={{ marginLeft: 6 }}>{t('report.myReports')}</Txt>
          <Card style={{ padding: 0 }}>
            {reports.length === 0 && <Txt variant="muted" style={{ padding: 18 }}>{t('report.none')}</Txt>}
            {reports.map((report, index) => {
              const tone = STATUS_COLOR[report.status] ?? STATUS_COLOR.closed;
              return (
                <View key={report.id} style={[styles.reportRow, index > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
                  <View style={styles.between}>
                    <Txt variant="strong" size={18}>{t(`report.${report.category}`)}</Txt>
                    <View style={[styles.status, { backgroundColor: tone.background }]}>
                      <Txt variant="strong" size={14} color={tone.text}>{t(`report.${report.status}`)}</Txt>
                    </View>
                  </View>
                  <Txt variant="small">{`${dateLabel(report.created_at)} ${colomboTime(report.created_at)}`}</Txt>
                  {report.note && <Txt variant="muted">{report.note}</Txt>}
                  {report.office_note && <Txt variant="strong" size={15} color={colors.blue}>{t('report.office', { note: report.office_note })}</Txt>}
                </View>
              );
            })}
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { minHeight: 52, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, justifyContent: 'center' },
  note: {
    minHeight: 96,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    fontSize: 17,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  photo: { width: 84, height: 84, borderRadius: 12, backgroundColor: colors.line },
  addPhoto: { backgroundColor: colors.card, borderWidth: 2, borderStyle: 'dashed', borderColor: '#b8b2a6', alignItems: 'center', justifyContent: 'center' },
  remove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportRow: { padding: 16, gap: 4 },
  status: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
});
