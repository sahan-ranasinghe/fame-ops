// Round 4–7, item 12: Office mode's trip Review (the trip editor's step 4) drawn with sample data, beside mockup 2
// (design/mockups/2026-10-22) in the mockup comparison's screenshots. The REAL screen (app/office/trip/review.tsx) with a
// sample draft (an assigned task: two stops, back at base, two passengers) and the fake client (sampleOffice.ts: plan_task's
// sample plan, no network; Send does nothing). The e2e build only (/m/design/office-review with FLEET_DESIGN=1).
//   ?lang=si          Sinhala

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import TripReview from '@/app/office/trip/review';
import { OfficeValueProvider } from '@/office/state';
import { setDraft } from '@/office/trip/draft';
import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { officeDesignLanguage, officeDesignValue, reviewAnswers, reviewDraft } from './sampleOffice';

export default function OfficeReviewDesign() {
  const params = useLocalSearchParams<{ lang?: string }>();
  const language = officeDesignLanguage(params.lang);
  const { language: now, setLanguage } = useApp();
  useEffect(() => {
    if (now !== language) setLanguage(language);
  }, [now, language, setLanguage]);
  const value = useMemo(() => officeDesignValue(reviewAnswers()), []);
  // The sample draft once, before the screen reads it (nobody is signed in on a design page: it lives on screen only).
  useState(() => {
    setDraft(reviewDraft());
    return true;
  });
  return (
    <OfficeValueProvider value={value}>
      <View testID="fleet-design-page" style={{ flex: 1, backgroundColor: colors.page }}>
        <TripReview />
      </View>
    </OfficeValueProvider>
  );
}
