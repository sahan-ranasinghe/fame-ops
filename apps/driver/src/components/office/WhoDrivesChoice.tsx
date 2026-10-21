// Round 3 (docs/phase8-plan.md §30, item 1): "Who drives?", the rental and car-sharing booking forms' "Who's driving?"
// (Turo, Enterprise): one question, three choices as the shared pick-one rows (ChoiceRow: the radio, the tint and the border
// when picked), the details under the chosen one. A driver (the default) · I'll drive myself · Someone else (a name and a
// phone, not in Fame Fleet). The screens show it only while the fleet setting self_drive_allowed is on (off = every trip
// needs a driver). A request that already asks the vehicle's custodian to drive (the old path) shows that as a fourth row.
// The rules: office/trip/whoDrivesLogic.ts.

import { View } from 'react-native';

import { ChoiceRow } from '@/components/patterns/Select';
import { Field, Txt } from '@/components/ui';
import { phoneE164 } from '@/lib/profile';
import { type WhoChoice, type WhoDrives, WHO_CHOICES } from '@/office/trip/whoDrivesLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const LABEL: Record<WhoChoice, string> = { driver: 'office.who.driver', self: 'office.who.self', other: 'office.who.other' };
const HINT: Record<WhoChoice, string> = { driver: 'office.who.driverHint', self: 'office.who.selfHint', other: 'office.who.otherHint' };

export function WhoDrivesChoice({ value, onChange, testID = 'who-drives' }: {
  value: WhoDrives;
  onChange: (next: WhoDrives) => void;
  testID?: string;
}) {
  const { t } = useApp();
  const pick = (choice: WhoDrives['choice']) => onChange({ ...value, choice });
  const phoneBad = value.choice === 'other' && value.phone.trim() !== '' && !phoneE164(value.phone);
  return (
    <View style={{ gap: 8 }} testID={testID}>
      <Txt variant="strong" size={16}>{t('office.who.title')}</Txt>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {WHO_CHOICES.map((c) => (
          <ChoiceRow key={c} selected={value.choice === c} onPress={() => pick(c)} accessibilityLabel={t(LABEL[c])} testID={`${testID}-${c}`}>
            <Txt variant="strong" size={16}>{t(LABEL[c])}</Txt>
            <Txt variant="small">{t(HINT[c])}</Txt>
          </ChoiceRow>
        ))}
        {value.choice === 'custodian' && (
          <ChoiceRow selected onPress={() => undefined} accessibilityLabel={t('office.who.custodian')} testID={`${testID}-custodian`}>
            <Txt variant="strong" size={16}>{t('office.who.custodian')}</Txt>
            <Txt variant="small">{t('office.who.custodianHint')}</Txt>
          </ChoiceRow>
        )}
      </View>
      {value.choice === 'other' && (
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
