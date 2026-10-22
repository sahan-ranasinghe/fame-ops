// Round 4–7, item 12: the driver's Today drawn with sample data, beside mockup 5 (design/mockups/2026-10-22) in the mockup
// comparison's screenshots. The REAL screen (app/(tabs)/index.tsx) and the real tab bar (components/TabBarView.tsx) under
// a sample state (sampleDriver.ts: no phone, no network, every action does nothing). The e2e build only: make-web-routes
// makes /m/design/driver-today of it with FLEET_DESIGN=1, and the deploy refuses a build with the marker below.
//   ?lang=si          Sinhala
//   ?state=new        the next task not accepted yet (Accept, Start task, Can't do this task)
//   ?state=check      the vehicle check needed
//   ?state=off        off duty
//   ?state=empty      no tasks

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';

import TodayScreen from '@/app/(tabs)/index';
import { TabBarView } from '@/components/TabBarView';
import { AppValueProvider, useApp } from '@/state/app';
import { colors } from '@/theme';
import { designLanguage, sampleApp, todayState } from './sampleDriver';

const TAB_ROUTES = ['index', 'mileage', 'fuel', 'report', 'me'].map((name) => ({ key: name, name }));

export default function DriverTodayDesign() {
  const params = useLocalSearchParams<{ lang?: string; state?: string }>();
  // ?lang=si: the page's language is the parameter's (default English), the site's own language set to it too (the
  // page's lang attribute and the fonts follow it), as the mockup comparison photographs both.
  const language = designLanguage(params.lang);
  const site = useApp();
  const { setLanguage } = site;
  useEffect(() => {
    if (site.language !== language) setLanguage(language);
  }, [site.language, language, setLanguage]);
  const value = useMemo(
    () => sampleApp({ language, now: Date.now(), today: todayState(params.state) }),
    [language, params.state],
  );
  return (
    <AppValueProvider value={value}>
      <View testID="fleet-design-page" style={{ flex: 1, backgroundColor: colors.page }}>
        <View style={{ flex: 1 }}>
          <TodayScreen />
        </View>
        <TabBarView routes={TAB_ROUTES} active={0} onPress={() => undefined} />
      </View>
    </AppValueProvider>
  );
}
