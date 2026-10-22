import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Check } from '@/components/icons';
import type { Language } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

// Each language is always written in its own script, whatever the current one is.
const NAMES: Record<Language, { label: string; font: string }> = {
  en: { label: 'English', font: fonts.bodySemiBold },
  si: { label: 'සිංහල', font: fonts.sinhalaBodySemiBold },
};

/** Both languages side by side (sign-in and Me screens); the picked one with its check, tint and border. */
export function LanguageSwitch({ onDark = false }: { onDark?: boolean }) {
  const { language, setLanguage } = useApp();
  return (
    <View accessibilityRole="radiogroup" style={[styles.row, onDark && { borderColor: '#4a5058' }]}>
      {(['en', 'si'] as const).map((code) => {
        const on = code === language;
        return (
          <Pressable
            key={code}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, selected: on }}
            onPress={() => setLanguage(code)}
            style={[styles.option, on && styles.optionOn]}
          >
            {on && <Check size={20} color={colors.blue} strokeWidth={3} />}
            <Text style={{ fontFamily: NAMES[code].font, fontSize: 17, color: on ? colors.blue : onDark ? '#ffffff' : colors.ink }}>
              {NAMES[code].label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The single pill that shows the language you can switch to: on the sign-in's dark header, and (`light`, Round 4–7 item
 * 12) at the top right of Today's thin top bar, a white round control like the mockup's.
 */
export function LanguagePill({ light = false }: { light?: boolean }) {
  const { language, setLanguage } = useApp();
  const other: Language = language === 'en' ? 'si' : 'en';
  return (
    <Pressable accessibilityRole="button" onPress={() => setLanguage(other)} style={[styles.pill, light && styles.pillLight]} testID="language-pill">
      <Text style={{ fontFamily: NAMES[other].font, fontSize: light ? 15 : 16, color: light ? colors.ink : '#ffffff' }}>{NAMES[other].label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, overflow: 'hidden' },
  option: { flex: 1, minHeight: 52, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderWidth: 2, borderColor: 'transparent', borderRadius: 12 },
  // The picked language: the check, the blue chip tint and the 2 px blue border (the selection rules, patterns/Select.tsx).
  optionOn: { backgroundColor: colors.blueChip, borderColor: colors.blue },
  pill: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#4a5058',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLight: { borderWidth: 1, borderColor: '#e2e0da', backgroundColor: colors.card, paddingHorizontal: 14 },
});
