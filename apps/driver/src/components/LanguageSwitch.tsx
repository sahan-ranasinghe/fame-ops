import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Language } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

// Each language is always written in its own script, whatever the current one is.
const NAMES: Record<Language, { label: string; font: string }> = {
  en: { label: 'English', font: fonts.bodySemiBold },
  si: { label: 'සිංහල', font: fonts.sinhalaBodySemiBold },
};

/** Both languages side by side (sign-in and Me screens). */
export function LanguageSwitch({ onDark = false }: { onDark?: boolean }) {
  const { language, setLanguage } = useApp();
  return (
    <View style={[styles.row, onDark && { borderColor: '#4a5058' }]}>
      {(['en', 'si'] as const).map((code) => {
        const on = code === language;
        return (
          <Pressable
            key={code}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => setLanguage(code)}
            style={[styles.option, on && { backgroundColor: onDark ? '#ffffff' : colors.ink }]}
          >
            <Text style={{ fontFamily: NAMES[code].font, fontSize: 17, color: on ? (onDark ? colors.ink : '#ffffff') : onDark ? '#ffffff' : colors.ink }}>
              {NAMES[code].label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The single pill on the Today header: shows the language you can switch to. */
export function LanguagePill() {
  const { language, setLanguage } = useApp();
  const other: Language = language === 'en' ? 'si' : 'en';
  return (
    <Pressable accessibilityRole="button" onPress={() => setLanguage(other)} style={styles.pill}>
      <Text style={{ fontFamily: NAMES[other].font, fontSize: 16, color: '#ffffff' }}>{NAMES[other].label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, overflow: 'hidden' },
  option: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  pill: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#4a5058',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
