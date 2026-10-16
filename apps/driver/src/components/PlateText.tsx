// A short sentence with a number plate in it ("WP CAB-4521: end reading", "Vehicle changed: WP KL-1234"), the plate
// in its mono chip as everywhere else. The text is t(key) with {plate} left in (taskLines.splitAtPlate), so the
// words stay in en.json / si.json and the plate goes where each language puts it.

import { View } from 'react-native';

import { splitAtPlate } from '@/components/taskLines';
import { Plate, Txt, type Variant } from '@/components/ui';

export function PlateText({ text, plate, variant = 'muted', color, size }: {
  text: string;
  plate: string;
  variant?: Variant;
  color?: string;
  size?: number;
}) {
  const parts = splitAtPlate(text);
  if (!parts) return <Txt variant={variant} color={color} size={size}>{text}</Txt>;
  const before = parts.before.trimEnd();
  const after = parts.after.trimStart();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: 4 }}>
      {before !== '' && <Txt variant={variant} color={color} size={size}>{before}</Txt>}
      {/* A space in the sentence becomes a gap; "WP CAB-4521:" keeps the colon close. */}
      <View style={{ marginLeft: before === '' ? 0 : parts.before !== before ? 6 : 2, marginRight: after === '' ? 0 : parts.after !== after ? 6 : 2 }}>
        <Plate regNo={plate} />
      </View>
      {after !== '' && <Txt variant={variant} color={color} size={size}>{after}</Txt>}
    </View>
  );
}
