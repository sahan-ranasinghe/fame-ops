// Hotfix O2-H2, Part 1c: the screen a crash shows instead of a white page (react-error-boundary's fallback, as production
// apps have). "Something went wrong" / "Your work was saved if you pressed Save.", Go back (resets that stack), Reload app
// (expo-updates reloadAsync, JavaScript only), and Show details (the error, the screen, the app version, the update id, the
// runtime and the first stack lines, scrubbed of anything personal: lib/crashLogic.ts) with Copy (Android's share sheet,
// whose Copy puts it on the clipboard; the text itself can be selected too). It needs nothing that may be the thing that
// broke: no app provider (the language from the key store), no custom fonts, no router (the caller passes the actions).
//
// `RouteCrash` is the per-stack boundary (expo-router's `export function ErrorBoundary` in a layout): it reports the
// error once and offers Go back within that stack.

import { useRouter, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deviceLanguage, translate } from '@/i18n';
import { details, reportCrash } from '@/lib/crash';
import { type CrashDetails, detailsText } from '@/lib/crashLogic';
import { getJson, KEYS } from '@/lib/kv';
import type { Language } from '@/lib/types';
import { colors } from '@/theme';

/** The crash texts in the phone's language, without the app's provider. */
export function words(): (k: string) => string {
  let lang: Language = 'en';
  try {
    lang = getJson<Language>(KEYS.language) ?? deviceLanguage();
  } catch {
    lang = 'en';
  }
  return (k: string) => translate(lang, k);
}

export async function reloadApp(): Promise<void> {
  try {
    const Updates = require('expo-updates') as { reloadAsync: () => Promise<void> };
    await Updates.reloadAsync();
  } catch {
    // A development build without updates: nothing to reload into.
  }
}

export function CrashScreen({ crash, onBack, onReload }: { crash: CrashDetails; onBack?: () => void; onReload: () => void }) {
  const t = useMemo(words, []);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const text = detailsText(crash);
  // A crash while the app was starting: the splash goes, so the crash screen is seen (never a frozen splash).
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);
  return (
    <View style={[styles.page, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 16 }]} testID="crash-screen">
      <ScrollView contentContainerStyle={{ gap: 14, paddingHorizontal: 20 }}>
        <Text style={styles.title} accessibilityRole="header">{t('crash.title')}</Text>
        <Text style={styles.body}>{t('crash.saved')}</Text>
        {onBack ? (
          <Pressable accessibilityRole="button" onPress={onBack} style={[styles.btn, styles.primary]} testID="crash-back">
            <Text style={styles.primaryText}>{t('crash.back')}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={onReload} style={[styles.btn, onBack ? styles.outline : styles.primary]} testID="crash-reload">
          <Text style={onBack ? styles.outlineText : styles.primaryText}>{t('crash.reload')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.link} testID="crash-details-toggle">
          <Text style={styles.linkText}>{open ? t('crash.hideDetails') : t('crash.showDetails')}</Text>
        </Pressable>
        {open ? (
          <View style={styles.details} testID="crash-details">
            <Text selectable style={styles.mono}>{text}</Text>
            <Pressable accessibilityRole="button" onPress={() => void Share.share({ message: text }).catch(() => undefined)} style={[styles.btn, styles.outline]} testID="crash-copy">
              <Text style={styles.outlineText}>{t('crash.copy')}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** The per-stack boundary: `export function ErrorBoundary(props) { return <RouteCrash {...props} home="/office" /> }`. */
export function RouteCrash({ error, retry, home }: ErrorBoundaryProps & { home: string }) {
  const router = useRouter();
  const crash = useMemo(() => details(error, true), [error]);
  useEffect(() => {
    reportCrash(crash);
  }, [crash]);
  const back = () => {
    try {
      if (router.canGoBack()) router.back();
      else router.replace(home as never);
    } catch {
      // No navigator to go back in: Try again below redraws the stack.
    }
    void retry();
  };
  return <CrashScreen crash={crash} onBack={back} onReload={() => void reloadApp()} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  title: { fontSize: 26, fontWeight: '800', color: colors.ink },
  body: { fontSize: 17, color: colors.ink, lineHeight: 24 },
  btn: { minHeight: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primary: { backgroundColor: colors.amber },
  primaryText: { fontSize: 18, fontWeight: '700', color: colors.ink },
  outline: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.line },
  outlineText: { fontSize: 17, fontWeight: '600', color: colors.ink },
  link: { minHeight: 48, justifyContent: 'center' },
  linkText: { fontSize: 16, fontWeight: '600', color: colors.blue },
  details: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 12 },
  mono: { fontFamily: 'monospace', fontSize: 13, color: colors.ink, lineHeight: 18 },
});
