// Round 4–7, item 12: the driver's task in progress drawn with sample data, beside mockup 6 (design/mockups/2026-10-22) in
// the mockup comparison's screenshots. The REAL screen (app/task/[id].tsx TaskView) under a sample state (sampleDriver.ts)
// with a still picture in place of the map (no map engine, no key, no tiles in the test browser) and a fixed position in
// place of the phone's GPS. The e2e build only: /m/design/driver-task (FLEET_DESIGN=1); the deploy refuses the marker.
//   ?lang=si       Sinhala
//   ?state=far     about 42 km from the stop: the distance and "I'm here, the pin is wrong" (the 300 m rule)

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { TaskView } from '@/app/task/[id]';
import { Navigation } from '@/components/icons';
import { Txt } from '@/components/ui';
import { AppValueProvider, useApp } from '@/state/app';
import { colors } from '@/theme';
import { designLanguage, sampleApp, sampleHere, taskState } from './sampleDriver';

/** The still map: the mockup's roads, the route in blue, the phone and stop 2. */
function StillMap() {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 390 470" preserveAspectRatio="none">
        <Path d="M-10 420 C 90 380, 150 400, 210 320 S 300 160, 400 120" fill="none" stroke="#ffffff" strokeWidth={12} />
        <Path d="M50 -10 C 80 120, 70 300, 120 480" fill="none" stroke="#ffffff" strokeWidth={8} />
        <Path d="M320 -10 C 300 120, 330 300, 360 480" fill="none" stroke="#ffffff" strokeWidth={8} />
        <Path d="M-10 200 C 120 210, 240 160, 400 230" fill="none" stroke="#f7f6f2" strokeWidth={6} />
        <Path d="M150 395 C 185 370, 205 340, 222 300 S 270 170, 300 140" fill="none" stroke={colors.blue} strokeWidth={6} strokeLinecap="round" />
      </Svg>
      <View style={[styles.me, { left: '34%', top: '81%' }]}>
        <Navigation size={14} color="#ffffff" strokeWidth={2.4} />
      </View>
      <View style={[styles.stop, { left: '73%', top: '25%' }]}>
        <Txt variant="strong" size={12} color="#ffffff">2</Txt>
      </View>
    </View>
  );
}

export default function DriverTaskDesign() {
  const params = useLocalSearchParams<{ lang?: string; state?: string }>();
  // ?lang=si: the page's language is the parameter's (default English), the site's own language set to it too (the
  // page's lang attribute and the fonts follow it), as the mockup comparison photographs both.
  const language = designLanguage(params.lang);
  const site = useApp();
  const { setLanguage } = site;
  useEffect(() => {
    if (site.language !== language) setLanguage(language);
  }, [site.language, language, setLanguage]);
  const now = useMemo(() => Date.now(), []);
  const value = useMemo(() => sampleApp({ language, now, running: true }), [language, now]);
  const design = useMemo(() => ({ here: sampleHere(taskState(params.state), now), map: <StillMap /> }), [params.state, now]);
  return (
    <AppValueProvider value={value}>
      <View testID="fleet-design-page" style={{ flex: 1, backgroundColor: colors.page }}>
        <TaskView id="t-sample-1" design={design} />
      </View>
    </AppValueProvider>
  );
}

const styles = StyleSheet.create({
  me: {
    position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: colors.blue, borderWidth: 3, borderColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center', marginLeft: -17, marginTop: -17,
  },
  stop: {
    position: 'absolute', width: 30, height: 30, borderRadius: 15, backgroundColor: colors.ink, borderWidth: 3, borderColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center', marginLeft: -15, marginTop: -15,
  },
});
