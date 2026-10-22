// Round 4–7, item 12 (the approved mockup 1; Gmail's Compose, Google Calendar's +, Material 3's extended FAB): the one
// floating "+ New trip" button, bottom right above the tab bar. With one choice it opens it; with two (Assign a task,
// Request a vehicle) the shared sheet asks which. Nothing when the person may do neither.

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Plus } from '@/components/icons';
import { Button, Txt } from '@/components/ui';
import { colors, hoverStyle, shadow } from '@/theme';
import { Sheet } from './Sheet';

export interface FabChoice { key: string; label: string; onPress: () => void }

export function NewTripFab({ label, choices, bottom = 16, testID = 'new-trip' }: { label: string; choices: readonly FabChoice[]; bottom?: number; testID?: string }) {
  const [open, setOpen] = useState(false);
  if (choices.length === 0) return null;
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => (choices.length === 1 ? choices[0].onPress() : setOpen(true))}
        style={(state) => [styles.fab, { bottom }, shadow(6), hoverStyle(state), state.pressed && { opacity: 0.85 }]} testID={testID}>
        <Plus size={20} color={colors.ink} strokeWidth={2.6} />
        <Txt variant="strong" size={16}>{label}</Txt>
      </Pressable>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)} testID={`${testID}-sheet`}>
        <View style={{ gap: 10 }}>
          {choices.map((c, i) => (
            <Button key={c.key} kind={i === 0 ? 'primary' : 'outline'} label={c.label} onPress={() => { setOpen(false); c.onPress(); }} style={{ minHeight: 56 }} testID={`${testID}-${c.key}`} />
          ))}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 16, minHeight: 52, paddingLeft: 16, paddingRight: 20, borderRadius: 26, backgroundColor: colors.amber, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#15181c', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
});
