// Round 4–7, item 12: Office mode's Home drawn with sample data, beside mockup 1 (design/mockups/2026-10-22) in the mockup
// comparison's screenshots. The REAL screen (app/office/(tabs)/index.tsx) and the real tab bar under the office context
// with a fake client (sampleOffice.ts: no network, every write does nothing). The e2e build only: make-web-routes makes
// /m/design/office-home of it with FLEET_DESIGN=1, and the deploy refuses a build with the marker below.
//   ?lang=si          Sinhala

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';

import OfficeHome from '@/app/office/(tabs)/index';
import { TabBar } from '@/app/office/(tabs)/_layout';
import { OfficeValueProvider } from '@/office/state';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { homeAnswers, officeDesignLanguage, officeDesignValue } from './sampleOffice';

const ROUTES = ['index', 'approve', 'tasks', 'drivers', 'live', 'trips', 'alerts', 'more'].map((name) => ({ key: name, name }));

export default function OfficeHomeDesign() {
  const params = useLocalSearchParams<{ lang?: string }>();
  const language = officeDesignLanguage(params.lang);
  const { language: now, setLanguage } = useApp();
  useEffect(() => {
    if (now !== language) setLanguage(language);
  }, [now, language, setLanguage]);
  const value = useMemo(() => officeDesignValue(homeAnswers()), []);
  return (
    <OfficeValueProvider value={value}>
      <View testID="fleet-design-page" style={{ flex: 1, backgroundColor: colors.page }}>
        <View style={{ flex: 1 }}>
          <OfficeHome />
        </View>
        <TabBar {...({ state: { index: 0, routes: ROUTES }, navigation: { navigate: () => undefined } } as unknown as Parameters<typeof TabBar>[0])} />
      </View>
    </OfficeValueProvider>
  );
}
