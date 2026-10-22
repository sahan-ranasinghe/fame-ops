// Round 4–7, item 12: Office mode's task page while the trip is on the way, drawn with sample data, beside mockup 4
// (design/mockups/2026-10-22) in the mockup comparison's screenshots. The REAL screen (app/office/task/[id].tsx) with the
// fake client (sampleOffice.ts: a running task with its ETA, passengers, holder, fuel card and check; the driver's position
// from live_drivers; no network). The map is the real task map: in the e2e (no internet) the free map's land or "Map not
// available" with the stops. The e2e build only (/m/design/office-trip with FLEET_DESIGN=1).
//   ?lang=si          Sinhala

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';

import TaskDetailScreen from '@/app/office/task/[id]';
import { OfficeValueProvider } from '@/office/state';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { officeDesignLanguage, officeDesignValue, tripAnswers } from './sampleOffice';

export default function OfficeTripDesign() {
  const params = useLocalSearchParams<{ lang?: string }>();
  const language = officeDesignLanguage(params.lang);
  const { language: now, setLanguage } = useApp();
  useEffect(() => {
    if (now !== language) setLanguage(language);
  }, [now, language, setLanguage]);
  const value = useMemo(() => officeDesignValue(tripAnswers()), []);
  return (
    <OfficeValueProvider value={value}>
      <View testID="fleet-design-page" style={{ flex: 1, backgroundColor: colors.page }}>
        <TaskDetailScreen />
      </View>
    </OfficeValueProvider>
  );
}
