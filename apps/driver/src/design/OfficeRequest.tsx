// Round 4–7, item 12: Office mode's request page for an approver drawn with sample data, beside mockup 3
// (design/mockups/2026-10-22) in the mockup comparison's screenshots. The REAL screen (app/office/request/[id].tsx) with the
// fake client (sampleOffice.ts: a waiting request with its plan, Who's available with the best match; no network, Approve
// and Decline do nothing). The e2e build only (/m/design/office-request with FLEET_DESIGN=1).
//   ?lang=si          Sinhala

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';

import ApproveRequest from '@/app/office/request/[id]';
import { OfficeValueProvider } from '@/office/state';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { officeDesignLanguage, officeDesignValue, requestAnswers } from './sampleOffice';

export default function OfficeRequestDesign() {
  const params = useLocalSearchParams<{ lang?: string }>();
  const language = officeDesignLanguage(params.lang);
  const { language: now, setLanguage } = useApp();
  useEffect(() => {
    if (now !== language) setLanguage(language);
  }, [now, language, setLanguage]);
  const value = useMemo(() => officeDesignValue(requestAnswers()), []);
  return (
    <OfficeValueProvider value={value}>
      <View testID="fleet-design-page" style={{ flex: 1, backgroundColor: colors.page }}>
        <ApproveRequest />
      </View>
    </OfficeValueProvider>
  );
}
