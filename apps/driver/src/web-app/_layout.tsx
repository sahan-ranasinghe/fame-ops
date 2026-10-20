// The mobile website's root (Phase 8, O4; app.config.ts with FLEET_WEB=1, docs/mobile-website.md). Office mode only: the
// fonts, the light provider (state/app.web.tsx: the words, the language), the office session checked once (offline is
// not signed out), the snackbar and the crash screen, and the service worker (public/sw.js: the offline page, web push).
// No location, no Expo push token, no queue: the driver's side is not here.

import { Archivo_800ExtraBold } from '@expo-google-fonts/archivo/800ExtraBold';
import { GemunuLibre_800ExtraBold } from '@expo-google-fonts/gemunu-libre/800ExtraBold';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans/700Bold';
import { Yaldevi_400Regular } from '@expo-google-fonts/yaldevi/400Regular';
import { Yaldevi_600SemiBold } from '@expo-google-fonts/yaldevi/600SemiBold';
import { useFonts } from 'expo-font';
import { type ErrorBoundaryProps, router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { installWebFormGuards } from '@/components/navigation';
import { RouteCrash } from '@/components/patterns/CrashScreen';
import { registerMobileWorker } from '@/lib/browserPush';
import { SnackbarHost } from '@/components/patterns/Snackbar';
import { sessionKind } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { bootOffice, refreshOfficeMe } from '@/office/auth';
import { routeForUrl } from '@/office/nav';
import { getOfficeMe } from '@/office/store';
import { AppProvider } from '@/state/app';
import { translate } from '@/i18n';
import { getJson, KEYS } from '@/lib/kv';
import { installWebAlert } from '@/lib/webAlert';
import { colors } from '@/theme';

// Every confirmation works in a browser (Alert.alert does nothing in react-native-web): lib/webAlert.ts.
installWebAlert(Alert, () => {
  const language = getJson<'en' | 'si'>(KEYS.language) ?? 'en';
  return { ok: translate(language, 'web.ok'), cancel: translate(language, 'web.cancel') };
});

// An unsaved form asks before a reload, a closed tab or the browser's own Back (components/navigation.ts).
installWebFormGuards();

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RouteCrash {...props} home="/" />;
}

export default function WebRoot() {
  const [loaded, error] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    Archivo_800ExtraBold,
    Yaldevi_400Regular,
    Yaldevi_600SemiBold,
    GemunuLibre_800ExtraBold,
  });
  const [booted, setBooted] = useState(false);
  // The office session checked once (offline is not signed out); a person already signed in on the desktop site (the same
  // browser session, one origin) arrives signed in here too.
  useEffect(() => {
    void (async () => {
      await bootOffice();
      if (!getOfficeMe() && sessionKind(await supabase.auth.getSession()) !== 'none') await refreshOfficeMe();
    })().finally(() => setBooted(true));
  }, []);
  // Step 5: the worker (the offline page, the office's pushes); a tap on a notification while the site is open opens its
  // screen here (the desktop link mapped by permission, as ?from= does after a sign-in).
  useEffect(() => registerMobileWorker((path) => {
    const me = getOfficeMe();
    router.push((me ? routeForUrl(path, me.permissions) ?? '/office' : '/login') as never);
  }), []);
  if ((!loaded && !error) || !booted) return <View style={{ flex: 1, backgroundColor: colors.page }} />;
  return (
    <AppProvider>
      <View style={{ flex: 1, backgroundColor: colors.page }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }} />
        <SnackbarHost />
      </View>
    </AppProvider>
  );
}
