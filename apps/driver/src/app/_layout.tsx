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
import { type ErrorBoundaryProps, Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';

import { LocationGate } from '@/components/LocationGate';
import { CrashScreen, reloadApp, RouteCrash, words } from '@/components/patterns/CrashScreen';
import { showSnackbar, SnackbarHost } from '@/components/patterns/Snackbar';
import { crashStore, installGlobalHandlers, noteScreen, useFatalCrash } from '@/lib/crash';
import { screenOf } from '@/lib/crashLogic';
import { anyFormDirty } from '@/components/navigation';
import { canEnterDriving, tapSide } from '@/lib/drivingMode';
import { tapData } from '@/lib/notifications';
import { bootOffice } from '@/office/auth';
import { holderAsksRoute } from '@/office/holderLogic';
import { routeForUrl } from '@/office/nav';
import { useOfficeMe } from '@/office/store';
import { AppProvider, useApp } from '@/state/app';
import { colors } from '@/theme';

// Keep the splash screen up until the fonts and the saved sign-in are ready (its promise may reject after a reload: never
// an unhandled rejection of its own).
SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Hotfix O2-H2, Part 1c: an error outside rendering (an event handler, a timer) or a promise nobody caught never freezes
// the app: a fatal one shows the crash screen over everything, any other one a snackbar.
installGlobalHandlers(() => showSnackbar({ text: words()('crash.soft'), tone: 'error' }));

/** Hotfix O2-H2: the last line of defence: a crash above every stack shows the crash screen, never a white page. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RouteCrash {...props} home="/" />;
}

function Screens({ fontsReady }: { fontsReady: boolean }) {
  const { booted, me, rememberPush, driving, enterDriving, showDriving } = useApp();
  const officeMe = useOfficeMe();
  const ready = fontsReady && booted;
  const router = useRouter();
  // The notification the app was opened with (or tapped while running): a task notification opens that task, a question
  // from the office (Part 3b) that question.
  const response = Notifications.useLastNotificationResponse();
  // The route on screen, for a crash's "Show details" (lib/crash.ts): its pattern ("/office/driver/[username]"), never the
  // person or the id in it.
  const segments = useSegments();
  const screenName = screenOf(segments);
  useEffect(() => {
    noteScreen(screenName);
  }, [screenName]);
  const fatal = useFatalCrash();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // Office mode (Phase 8): the office person's session checked once at start (lib/session.ts: offline is not signed out).
  useEffect(() => {
    void bootOffice();
  }, []);

  // Which side a tapped notification opens (Round 50, lib/drivingMode.ts tapSide): an office notification (notify-office)
  // its screen in Office mode; a task's (push-task, every other kind) the driver screen, in Driving mode for an office person
  // (entered first when only Office mode is loaded and the person can drive). A driver alone, or an office person alone,
  // works as before.
  useEffect(() => {
    if (!ready || !response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    const data = tapData(response);
    const side = tapSide(data, { driver: !!me, office: !!officeMe, canDrive: canEnterDriving(officeMe, Platform.OS !== 'web') });
    if (side === null) return;
    handled.current = id;
    if (side === 'office' && officeMe) {
      // Phase 8 (O1 item 9): an office notification's tap opens its screen in Office mode (the link's screen, else Alerts).
      router.navigate('/office');
      // The link's screen; a holder.* push the person cannot open as a task opens the Asks page (as in Alerts).
      const target = routeForUrl(data.url, officeMe.permissions) ?? holderAsksRoute({ event: data.event ?? '' });
      if (target) router.push(target as never);
      else router.navigate('/office/(tabs)/alerts');
      return;
    }
    const openDriver = () => {
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
      // Round 4–7 (§33.2): "Fill up on the way? Log fuel" opens Log fuel for the task (Today underneath, as a task's tap; a
      // form with unsaved input stays underneath instead).
      if (data.kind === 'fuel') {
        if (!anyFormDirty()) {
          if (router.canGoBack()) router.dismissAll();
          router.navigate('/');
        }
        router.push({ pathname: '/log-mileage', params: { mode: 'fuel', taskId } });
        return;
      }
      // Hotfix 2 (I): a "Task changed" push's changes are kept first, so the task opens with them marked.
      rememberPush(data);
      // A form with unsaved input stays underneath (back returns to it); otherwise Today does.
      if (!anyFormDirty()) {
        if (router.canGoBack()) router.dismissAll();
        router.navigate('/');
      }
      router.push({ pathname: '/task/[id]', params: { id: taskId } });
    };
    if (side === 'enter_driving') {
      void enterDriving().then((outcome) => {
        if (outcome === 'ok') openDriver();
      });
      return;
    }
    // An office person's driver state behind Office mode: the driver screens come to the front first.
    showDriving();
    openDriver();
  }, [ready, me, officeMe, response, router, rememberPush, enterDriving, showDriving]);

  // A fatal error before the app is ready still shows the crash screen (over the splash, which it hides), never a frozen
  // splash.
  if (!ready) return fatal ? <CrashScreen crash={fatal} onReload={() => void reloadApp()} /> : null;
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }} />
      {/* Round 50: an office person's driver state behind Office mode puts no cover over Office mode. */}
      {me && driving && <LocationGate />}
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
