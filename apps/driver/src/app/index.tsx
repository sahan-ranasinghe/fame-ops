// Placeholder for the shell build: it only shows that the app, the fonts and
// the server settings arrived. The real screens replace it in the next step.

import Constants from 'expo-constants';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isSupabaseConfigured, SUPABASE_URL } from '@/config';
import { deviceLanguage, translate } from '@/i18n';
import { colors, fonts } from '@/theme';

export default function ShellScreen() {
  const insets = useSafeAreaInsets();
  const language = deviceLanguage();
  const t = (key: string) => translate(language, key);
  const bodyFont = language === 'si' ? fonts.sinhalaBody : fonts.body;
  const strongFont = language === 'si' ? fonts.sinhalaBodySemiBold : fonts.bodySemiBold;
  const server = SUPABASE_URL.replace(/^https?:\/\//, '');

  return (
    <View style={styles.page}>
      <View style={[styles.header, { paddingTop: insets.top + 28 }]}>
        <Text style={[styles.version, { fontFamily: bodyFont }]}>
          {t('shell.version')} <Text style={styles.mono}>{Constants.expoConfig?.version}</Text>
        </Text>
        <Text style={styles.title}>{Constants.expoConfig?.name}</Text>
      </View>

      <View style={styles.card}>
        <Text style={[styles.ready, { fontFamily: strongFont }]}>{t('shell.ready')}</Text>
        <Text style={[styles.next, { fontFamily: bodyFont }]}>{t('shell.next')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={[styles.label, { fontFamily: bodyFont }]}>{t('shell.server')}</Text>
        {server !== '' && <Text style={styles.server}>{server}</Text>}
        <Text style={[styles.status, { fontFamily: strongFont, color: isSupabaseConfigured ? colors.blue : colors.red }]}>
          {t(isSupabaseConfigured ? 'shell.serverConfigured' : 'shell.serverMissing')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { backgroundColor: colors.ink, paddingHorizontal: 20, paddingBottom: 28, marginBottom: 4 },
  version: { color: '#b9bec4', fontSize: 15 },
  mono: { fontFamily: fonts.mono },
  title: { color: '#ffffff', fontFamily: fonts.heading, fontSize: 32, marginTop: 2 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 18,
  },
  ready: { color: colors.ink, fontSize: 19 },
  next: { color: colors.muted, fontSize: 16, marginTop: 6 },
  label: { color: colors.muted, fontSize: 14 },
  server: { color: colors.ink, fontFamily: fonts.mono, fontSize: 15, marginTop: 4 },
  status: { fontSize: 16, marginTop: 6 },
});
