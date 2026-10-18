// "Which vehicle?" (Hotfix 2, J): Start task on a task made without a vehicle asks for it first, on the Log mileage
// screen above the odometer (app/log-mileage.tsx, start mode). The vehicle the driver holds is offered first when it
// fits ("Use WP CAB-4521"); "Choose another vehicle" lists the vehicles (my_vehicle_choices; the saved list offline),
// of the wanted type only for "Any van". The server decides (lib/vehicleConfirm.ts): set at once with a connection,
// kept on the phone and sent before the start without one; a refusal is said in words and the choice stays open.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Check } from '@/components/icons';
import { Button, Card, Mono, Notice, Txt } from '@/components/ui';
import type { VehicleChoice } from '@/lib/api';
import { typeWord } from '@/lib/taskPreview';
import type { TaskWithStops, Vehicle } from '@/lib/types';
import { candidates, heldFits, refusalWords, vehicleFits, wantedType } from '@/lib/vehicleConfirm';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

type Choice = Pick<VehicleChoice, 'id' | 'reg_no' | 'make_model' | 'vehicle_type' | 'in_garage' | 'held_by' | 'mine_now'>;

const fromSaved = (v: Vehicle, mine: string | null): Choice => ({
  id: v.id,
  reg_no: v.reg_no,
  make_model: v.make_model,
  vehicle_type: v.vehicle_type,
  in_garage: v.in_garage,
  held_by: null,
  mine_now: v.id === mine,
});

export function VehicleConfirm({ task, onBusy, onConfirmed }: {
  task: TaskWithStops;
  onBusy?: (busy: boolean) => void;
  /** The vehicle is set (or kept on the phone to be sent first): the odometer step takes this card's place. */
  onConfirmed?: () => void;
}) {
  const app = useApp();
  const { t } = app;
  const type = wantedType(task);
  const held = app.vehicle;
  const offer = heldFits(task, held);
  const [picking, setPicking] = useState(offer === null);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const { loadVehicleChoices } = app;
  useEffect(() => {
    if (!picking || choices !== null) return;
    void loadVehicleChoices().then((rows) => setChoices(rows ?? app.vehicles.filter((v) => v.active).map((v) => fromSaved(v, held?.id ?? null))));
    // Once, when the list is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  const list = choices ? candidates(task, choices) : [];
  const chosen = picked ? list.find((v) => v.id === picked) ?? null : null;

  async function confirm(vehicle: Pick<Choice, 'id' | 'reg_no' | 'vehicle_type' | 'in_garage'>) {
    if (busy) return;
    setProblem(null);
    // The rules the server applies, said before asking it (a vehicle in the garage, of the wrong type).
    const fits = vehicleFits(task, vehicle);
    if (fits !== 'ok') return setProblem(t('vehicleConfirm.failed', { reason: refusalWords(t, fits, vehicle.reg_no, type) }));
    setBusy(true);
    onBusy?.(true);
    const outcome = await app.confirmTaskVehicle(task, vehicle.id);
    setBusy(false);
    onBusy?.(false);
    if (outcome.kind === 'refused') return setProblem(t('vehicleConfirm.failed', { reason: refusalWords(t, outcome.answer, vehicle.reg_no, type) }));
    // 'ok' / 'queued': the task has its vehicle now (the phone's copy too) and the odometer step takes this card's place.
    onConfirmed?.();
  }

  return (
    <Card style={{ gap: 12 }}>
      <Txt variant="big">{t('vehicleConfirm.title')}</Txt>
      <Txt variant="muted">{t('vehicleConfirm.body')}</Txt>
      {type && <Txt variant="strong" color={colors.amberText}>{t('vehicleConfirm.needsType', { type: typeWord(t, type) })}</Txt>}
      {/* The vehicle held does not fit: why, so the driver knows to choose another. */}
      {held && !offer && <Notice tone="warn" text={refusalWords(t, vehicleFits(task, held), held.reg_no, type)} />}

      {offer && !picking && (
        <>
          <Button icon={Check} label={t('vehicleConfirm.use', { plate: offer.reg_no })} busy={busy} onPress={() => void confirm(offer)} />
          <Button kind="outline" label={t('vehicleConfirm.pick')} disabled={busy} onPress={() => setPicking(true)} />
        </>
      )}

      {picking && (
        <View style={{ gap: 8 }}>
          {choices === null ? (
            <ActivityIndicator color={colors.ink} style={{ marginVertical: 12 }} />
          ) : (
            list.map((v) => {
              const fits = vehicleFits(task, v) === 'ok';
              const selected = picked === v.id;
              const tags = [
                v.mine_now ? t('vehicle.yours') : v.held_by ? t('vehicle.withDriver', { name: v.held_by }) : null,
                v.in_garage ? t('vehicle.inGarage') : null,
              ].filter(Boolean).join(' · ');
              return (
                <Pressable
                  key={v.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: !fits }}
                  onPress={() => {
                    setProblem(null);
                    setPicked(v.id);
                  }}
                  style={[styles.row, selected && styles.selected, !fits && { opacity: 0.55 }]}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={styles.plate}><Mono size={18} bold>{v.reg_no}</Mono></View>
                    {v.make_model && <Txt variant="muted" numberOfLines={1}>{v.make_model}</Txt>}
                    {tags !== '' && <Txt variant="small" color={v.in_garage ? colors.amberText : colors.muted}>{tags}</Txt>}
                  </View>
                  {selected && <Check size={24} color={colors.ink} strokeWidth={3} />}
                </Pressable>
              );
            })
          )}
          {choices !== null && list.length === 0 && <Txt variant="muted">{t('vehicle.none')}</Txt>}
          {chosen && <Button icon={Check} label={t('vehicleConfirm.use', { plate: chosen.reg_no })} busy={busy} onPress={() => void confirm(chosen)} />}
        </View>
      )}

      {problem && <Notice tone="danger" text={problem} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  selected: { borderColor: colors.ink, borderWidth: 2.5 },
  plate: { alignSelf: 'flex-start', borderWidth: 1.5, borderColor: colors.ink, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 1 },
});
