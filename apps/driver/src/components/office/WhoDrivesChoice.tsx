// Round 3 (docs/phase8-plan.md §30, item 1): "Who drives?", the rental and car-sharing booking forms' "Who's driving?"
// (Turo, Enterprise): one question, three choices as the shared pick-one rows (ChoiceRow: the radio, the tint and the border
// when picked), the details under the chosen one. A driver (the default) · I'll drive myself · Someone else (a name and a
// phone, not in Fame Fleet). The screens show it only while the fleet setting self_drive_allowed is on (off = every trip
// needs a driver). A request that asked the vehicle's custodian (the old path) reads as a driver here, as on the site: nothing
// is sent unless the answer changes. The rules: office/trip/whoDrivesLogic.ts (the site's file); the keys: whoWords.ts.

import { View } from 'react-native';

import { ChoiceRow } from '@/components/patterns/Select';
import { Field, Txt } from '@/components/ui';
import { phoneE164 } from '@/office/trip/phones';
import type { DrivenBy, WhoDrivesValue } from '@/office/trip/whoDrivesLogic';
import { WHO_CHOICES } from '@/office/trip/whoWords';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const LABEL: Record<DrivenBy, string> = { driver: 'office.who.driver', self: 'office.who.self', other: 'office.who.other' };
const HINT: Record<DrivenBy, string> = { driver: 'office.who.driverHint', self: 'office.who.selfHint', other: 'office.who.otherHint' };

export function WhoDrivesChoice({ value, onChange, testID = 'who-drives' }: {
  value: WhoDrivesValue;
  onChange: (next: WhoDrivesValue) => void;
  testID?: string;
}) {
  const { t } = useApp();
  const pick = (by: DrivenBy) => onChange({ ...value, by });
  const phoneBad = value.by === 'other' && phoneE164(value.phone) === 'bad';
  return (
    <View style={{ gap: 8 }} testID={testID}>
      <Txt variant="strong" size={16}>{t('office.who.title')}</Txt>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {WHO_CHOICES.map((c) => (
          <ChoiceRow key={c} selected={value.by === c} onPress={() => pick(c)} accessibilityLabel={t(LABEL[c])} testID={`${testID}-${c}`}>
            <Txt variant="strong" size={16}>{t(LABEL[c])}</Txt>
            <Txt variant="small">{t(HINT[c])}</Txt>
          </ChoiceRow>
        ))}
      </View>
      {value.by === 'other' && (
        <View style={{ gap: 12, paddingTop: 4 }} testID={`${testID}-details`}>
          <Field label={t('office.who.name')} value={value.name} onChangeText={(name) => onChange({ ...value, name })} maxLength={120} placeholder={t('office.who.namePlaceholder')} testID={`${testID}-name`} />
          <View style={{ gap: 4 }}>
            <Field label={t('office.who.phone')} mono value={value.phone} onChangeText={(phone) => onChange({ ...value, phone })} keyboardType="phone-pad" maxLength={30} placeholder="077 123 4567" testID={`${testID}-phone`} />
            <Txt variant="small" color={phoneBad ? colors.red : colors.muted}>{t(phoneBad ? 'office.who.phoneBad' : 'office.who.phoneHint')}</Txt>
          </View>
        </View>
      )}
    </View>
  );
}
