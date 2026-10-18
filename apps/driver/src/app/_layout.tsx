import { Archivo_800ExtraBold } from '@expo-google-fonts/archivo/800ExtraBold';
import { GemunuLibre_700Bold } from '@expo-google-fonts/gemunu-libre/700Bold';
import { GemunuLibre_800ExtraBold } from '@expo-google-fonts/gemunu-libre/800ExtraBold';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans/700Bold';
import { NotoSansSinhala_400Regular } from '@expo-google-fonts/noto-sans-sinhala/400Regular';
import { Yaldevi_400Regular } from '@expo-google-fonts/yaldevi/400Regular';
import { Yaldevi_600SemiBold } from '@expo-google-fonts/yaldevi/600SemiBold';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { LocationGate } from '@/components/LocationGate';
import { anyFormDirty } from '@/components/navigation';
import { tapData } from '@/lib/notifications';
import { AppProvider, useApp } from '@/state/app';
import { colors } from '@/theme';

// Keep the splash screen up until the fonts and the saved sign-in are ready.
SplashScreen.preventAutoHideAsync();

function Screens({ fontsReady }: { fontsReady: boolean }) {
  const { booted, me, rememberPush } = useApp();
  const ready = fontsReady && booted;
  const router = useRouter();
  // The notification the app was opened with (or tapped while running): a task notification opens that task.
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (!ready || !me || !response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const data = tapData(response);
    const { taskId } = data;
    if (!taskId) return;
    // Hotfix 2 (I): a "Task changed" push's changes are kept first, so the task opens with them marked.
    rememberPush(data);
    // A form with unsaved input stays underneath (back returns to it); otherwise Today does.
    if (!anyFormDirty()) {
      if (router.canGoBack()) router.dismissAll();
      router.navigate('/');
    }
    router.push({ pathname: '/task/[id]', params: { id: taskId } });
  }, [ready, me, response, router, rememberPush]);

  if (!ready) return null;
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }} />
      {me && <LocationGate />}
    </View>
  );
}

export default function RootLayout() {
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
    GemunuLibre_700Bold,
    GemunuLibre_800ExtraBold,
    NotoSansSinhala_400Regular,
  });

  return (
    <AppProvider>
      <Screens fontsReady={loaded || error !== null} />
    </AppProvider>
  );
}
