// The "Report a problem" form: what happened, a note, 1 to 3 photos. Used by
// the Report tab (problems outside a task) and by the report-problem screen
// pushed from a task or from Log mileage (vehicle and task filled in).
// Phase 7 Part 2: during a task, a breakdown or an accident offers the tick "I need another vehicle"
// (the fleet admins are told at once); it is cleared when the category changes.

import { Camera, X } from '@/components/icons';
import { Checkbox, ChoiceChip } from '@/components/patterns/Select';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, Notice, Plate, Txt } from '@/components/ui';
import { discardPhoto, type LocalPhoto, takePhoto } from '@/lib/photos';
import type { ReportCategory, Vehicle } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const CATEGORIES: ReportCategory[] = ['breakdown', 'accident', 'tyre', 'warning_light', 'other'];
/** The categories that may stop the vehicle: during a task they offer "I need another vehicle". */
const VEHICLE_STOPPED: ReportCategory[] = ['breakdown', 'accident'];
const MAX_PHOTOS = 3;

export function ReportForm({ vehicle, taskId, onSent, onDirtyChange }: {
  vehicle: Vehicle | null;
  /** The task the problem belongs to, if any. */
  taskId: string | null;
  /** needsVehicle: the report asked for another vehicle. */
  onSent: (sent: { needsVehicle: boolean }) => void;
  /** Told whenever the form gains or loses unsaved input. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const app = useApp();
  const { t, language } = app;
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [needVehicle, setNeedVehicle] = useState(false);
  // Only during a task under way (the office's issue is for a running task), and only for a breakdown or an accident.
  const running = taskId !== null && app.tasks.some((task) => task.id === taskId && task.status === 'in_progress');
  const canAskVehicle = running && category !== null && VEHICLE_STOPPED.includes(category);

  const dirty = category !== null || note.trim() !== '' || photos.length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
    const needsVehicle = canAskVehicle && needVehicle;
    app.sendReport(category, note, photos, taskId, vehicle.id, needsVehicle);
    setCategory(null);
    setNote('');
    setPhotos([]);
    setProblem(null);
    setNeedVehicle(false);
    onSent({ needsVehicle });
  }

  return (
    <Card style={{ gap: 16 }}>
      <View style={styles.between}>
        <Txt variant="strong">{t('report.vehicle')}</Txt>
        {vehicle ? <Plate regNo={vehicle.reg_no} /> : <Txt variant="muted">{t('today.noVehicle')}</Txt>}
      </View>

      <View style={{ gap: 10 }}>
        <Txt variant="big">{t('report.what')}</Txt>
        <View accessibilityRole="radiogroup" style={styles.chips}>
          {CATEGORIES.map((item) => {
            const on = item === category;
            return (
              <ChoiceChip
                key={item}
                label={t(`report.${item}`)}
                selected={on}
                onPress={() => {
                  if (item !== category) setNeedVehicle(false);
                  setCategory(item);
                  setProblem(null);
                }}
                style={styles.chip}
                testID={`report-${item}`}
              />
            );
          })}
        </View>
      </View>

      {canAskVehicle && (
        <Checkbox
          checked={needVehicle}
          onChange={setNeedVehicle}
          label={t('report.needVehicle')}
          hint={t('report.needVehicleHint')}
          tone="danger"
          testID="report-need-vehicle"
        />
      )}

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
      <Button label={t('report.send')} onPress={send} />
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { minHeight: 52, paddingHorizontal: 16, borderRadius: 12 },
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
});
