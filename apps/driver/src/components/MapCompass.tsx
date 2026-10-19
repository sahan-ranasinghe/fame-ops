// The compass over the app's maps (Phase 7, §24): a round button that shows only while the map is turned or tilted
// (isTurned in taskMapLogic.ts). Its needle points north on the map as it is now; one tap turns the map north-up with
// no tilt (the map's own reset, passed in as onPress). JS only: the maps' own compasses stay off.

import LocateFixed from 'lucide-react-native/icons/locate-fixed';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/theme';
import { isTurned } from './taskMapLogic';

interface Props {
  /** The map's heading (bearing), degrees clockwise from north. */
  heading: number;
  pitch: number;
  /** "North up", for TalkBack. */
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function MapCompass({ heading, pitch, label, onPress, style }: Props) {
  if (!isTurned(heading, pitch)) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={[styles.button, style]}>
      <View style={{ transform: [{ rotate: `${-heading}deg` }] }}>
        <Svg width={30} height={30} viewBox="0 0 30 30">
          <Path d="M15 2 L20 15 L10 15 Z" fill={colors.red} />
          <Path d="M15 28 L20 15 L10 15 Z" fill={colors.muted} />
          <Circle cx={15} cy={15} r={2.4} fill={colors.card} />
        </Svg>
      </View>
    </Pressable>
  );
}

/** Follow me (Part 6, both maps): on = the phone stays in the middle; a pan or a pinch turns it off. */
export function FollowButton({ on, label, onPress, style }: { on: boolean; label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={onPress} hitSlop={8}
      style={[styles.button, on && { backgroundColor: colors.blue }, style]}>
      <LocateFixed size={26} color={on ? '#ffffff' : colors.blue} strokeWidth={2.4} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
});
