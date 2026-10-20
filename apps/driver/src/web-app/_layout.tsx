// The mobile website's root (Phase 8, O4; app.config.ts with FLEET_WEB=1, docs/mobile-website.md). Office mode only: the
// fonts, the light provider (state/app.web.tsx: the words, the language), the office session checked once (offline is
// not signed out), the snackbar and the crash screen. No location, no push token, no queue: the driver's side is not here.

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
import { type ErrorBoundaryProps, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { RouteCrash } from '@/components/patterns/CrashScreen';
import { SnackbarHost } from '@/components/patterns/Snackbar';
import { bootOffice } from '@/office/auth';
import { AppProvider } from '@/state/app';
import { colors } from '@/theme';

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
  useEffect(() => {
    void bootOffice().finally(() => setBooted(true));
  }, []);
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
