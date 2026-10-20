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
import * as Notifications from 'expo-notifications';
import { type ErrorBoundaryProps, Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { LocationGate } from '@/components/LocationGate';
import { CrashScreen, reloadApp, RouteCrash, words } from '@/components/patterns/CrashScreen';
import { showSnackbar, SnackbarHost } from '@/components/patterns/Snackbar';
import { crashStore, installGlobalHandlers, noteScreen, useFatalCrash } from '@/lib/crash';
import { anyFormDirty } from '@/components/navigation';
import { tapData } from '@/lib/notifications';
import { bootOffice } from '@/office/auth';
import { routeForUrl } from '@/office/nav';
import { useOfficeMe } from '@/office/store';
import { AppProvider, useApp } from '@/state/app';
import { colors } from '@/theme';

// Keep the splash screen up until the fonts and the saved sign-in are ready.
SplashScreen.preventAutoHideAsync();

// Hotfix O2-H2, Part 1c: an error outside rendering (an event handler, a timer) or a promise nobody caught never freezes
// the app: a fatal one shows the crash screen over everything, any other one a snackbar.
installGlobalHandlers(() => showSnackbar({ text: words()('crash.soft'), tone: 'error' }));

/** Hotfix O2-H2: the last line of defence: a crash above every stack shows the crash screen, never a white page. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RouteCrash {...props} home="/" />;
}

function Screens({ fontsReady }: { fontsReady: boolean }) {
  const { booted, me, rememberPush } = useApp();
  const officeMe = useOfficeMe();
  const ready = fontsReady && booted;
  const router = useRouter();
  // The notification the app was opened with (or tapped while running): a task notification opens that task, a question
  // from the office (Part 3b) that question.
  const response = Notifications.useLastNotificationResponse();
  // The route on screen, for a crash's "Show details" (lib/crash.ts).
  const pathname = usePathname();
  useEffect(() => {
    noteScreen(pathname);
  }, [pathname]);
  const fatal = useFatalCrash();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Office mode (Phase 8): the office person's session checked once at start (lib/session.ts: offline is not signed out).
  useEffect(() => {
    void bootOffice();
  }, []);

  // Phase 8 (O1 item 9): an office notification's tap opens its screen in Office mode (the link's screen, else Alerts).
  useEffect(() => {
    if (!ready || !officeMe || me || !response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const data = tapData(response);
    if (data.kind !== 'office') return;
    router.navigate('/office');
    const target = routeForUrl(data.url, officeMe.permissions);
    if (target) router.push(target as never);
    else router.navigate('/office/(tabs)/alerts');
  }, [ready, me, officeMe, response, router]);

  useEffect(() => {
    if (!ready || !me || !response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const data = tapData(response);
    const { taskId, askId } = data;
    // Part 3b (H3): a question from the office opens the question, the same way as a task (Today underneath).
    if (data.kind === 'ask' && askId) {
      if (!anyFormDirty()) {
        if (router.canGoBack()) router.dismissAll();
        router.navigate('/');
      }
      router.push({ pathname: '/ask/[id]', params: { id: askId } });
      return;
    }
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
      <SnackbarHost />
      {fatal ? (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
          <CrashScreen crash={fatal} onBack={() => crashStore.set(null)} onReload={() => void reloadApp()} />
        </View>
      ) : null}
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
    GemunuLibre_800ExtraBold,
  });

  return (
    <AppProvider>
      <Screens fontsReady={loaded || error !== null} />
    </AppProvider>
  );
}
