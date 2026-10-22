// Round 4–7, feature 5 (docs/phase8-plan.md §33.2): the "Trip info" card at Start task (app/log-mileage.tsx mode start,
// after the vehicle check and "Which vehicle?", above the odometer step). Advisory, never blocking (Google Maps' fuel
// estimate, Uber's trip info card): "About 180 km · roughly 12–15 L petrol (approx.)" and "Enough fuel?" Yes / I'll fill
// up on the way; the answer is optional and goes with Start task (state/app.tsx startTask, queued). Electric: "About
// 180 km · check the battery", no question. No km (no plan) or the switch fuel_card off: no card.
// The estimate comes from fuel_estimate (lib/api.ts) and is kept on the phone per task (the newest 10): offline the copy
// kept, else what the phone knows (the plan's km, the vehicle's fuel type). The task's preview asks for it ahead
// (prefetchFuelEstimate), so the card has it when the start is made without a connection.

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Fuel } from '@/components/icons';
import { Segmented, Txt } from '@/components/ui';
import { fetchFuelEstimate } from '@/lib/api';
import {
  asksQuestion,
  ESTIMATE_TIMEOUT_MS,
  estimateLine,
  type FuelAnswer,
  fuelCardShown,
  type FuelEstimate,
  keepEstimate,
  phoneEstimate,
  sourceKey,
} from '@/lib/fuelCard';
import { getJson, KEYS, setJson } from '@/lib/kv';
import { withTimeout } from '@/lib/patterns/listLogic';
import { supabase } from '@/lib/supabase';
import type { TaskWithStops, Vehicle } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const kept = (taskId: string): FuelEstimate | null => getJson<Record<string, FuelEstimate>>(KEYS.fuelEstimates)?.[taskId] ?? null;

/** Asks the server for the task's estimate and keeps it on the phone (best effort: nothing is said when it fails). */
export async function prefetchFuelEstimate(taskId: string): Promise<FuelEstimate | null> {
  try {
    const fresh = await withTimeout(fetchFuelEstimate(supabase, taskId), ESTIMATE_TIMEOUT_MS);
    if (fresh) setJson(KEYS.fuelEstimates, keepEstimate(getJson<Record<string, FuelEstimate>>(KEYS.fuelEstimates), fresh));
    return fresh;
  } catch {
    return null;
  }
}

/** The task's estimate: the server's (asked when online), else the copy kept, else what the phone knows itself. */
function useFuelEstimate(task: TaskWithStops, vehicle: Vehicle | null, online: boolean, on: boolean): FuelEstimate {
  const [server, setServer] = useState<FuelEstimate | null>(() => kept(task.id));
  useEffect(() => {
    if (!online || !on) return;
    let live = true;
    void prefetchFuelEstimate(task.id).then((fresh) => {
      if (live && fresh) setServer(fresh);
    });
    return () => {
      live = false;
    };
  }, [task.id, online, on]);
  return server ?? phoneEstimate(task, vehicle);
}

export function FuelCard({ task, vehicle, answer, onAnswer }: {
  task: TaskWithStops;
  vehicle: Vehicle | null;
  /** The driver's answer on this screen (none yet: null). */
  answer: FuelAnswer | null;
  onAnswer: (answer: FuelAnswer) => void;
}) {
  const { t, settings, offline, dataAvailable } = useApp();
  const est = useFuelEstimate(task, vehicle, !offline && dataAvailable, settings.fuel_card);
  if (!fuelCardShown(settings.fuel_card, est)) return null;
  const line = estimateLine(t, est);
  const source = sourceKey(est);
  return (
    <View style={styles.card} testID="fuel-card">
      <View style={styles.top}>
        <Fuel size={22} color={colors.blue} strokeWidth={2.4} />
        <Txt variant="label" color={colors.blue}>{t('fuelCard.title')}</Txt>
      </View>
      {line ? <Txt variant="big" testID="fuel-card-line">{line}</Txt> : null}
      {source ? <Txt variant="small">{t(source)}</Txt> : null}
      {asksQuestion(est) && (
        <View style={{ gap: 8 }}>
          <Txt variant="strong">{t('fuelCard.question')}</Txt>
          <Segmented<FuelAnswer>
            value={answer}
            onChange={onAnswer}
            options={[{ value: 'enough', label: t('common.yes') }, { value: 'fill_on_way', label: t('fuelCard.fillOnWay') }]}
          />
          {answer === 'fill_on_way' && <Txt variant="small">{t('fuelCard.reminderHint')}</Txt>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 18, gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
