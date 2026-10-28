// A password or PIN box: Material's password field with the visibility toggle (docs/ui-patterns.md §19). The same
// labelled Field as every other box, with secureTextEntry on until the eye at the right is pressed (lucide's eye /
// eye-off, a 48 px button for TalkBack: "Show password" / "Hide password", a PIN "Show PIN" / "Hide PIN", in both
// languages through common.*). Hidden by default; the value is never logged (the crash report sends only a message, a
// screen and a stack: lib/crashLogic.ts). On the web (/m/) react-native-web turns secureTextEntry into type="password",
// so the same component serves the website's phone build; aria-pressed goes through for a browser's reader.
import { useState } from 'react';
import { Pressable, StyleSheet, type TextInputProps, View } from 'react-native';

import { Eye, EyeOff } from '@/components/icons';
import { Field } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';

export type SecretKind = 'password' | 'pin';

/** The eye's words, by what the box holds (i18n keys). */
export const SECRET_WORDS: Record<SecretKind, { show: string; hide: string }> = {
  password: { show: 'common.showPassword', hide: 'common.hidePassword' },
  pin: { show: 'common.showPin', hide: 'common.hidePin' },
};

type Props = Omit<TextInputProps, 'secureTextEntry'> & {
  label: string;
  /** What the box holds: the eye's words. */
  kind?: SecretKind;
  /** `mono` as on Field (a PIN). */
  mono?: boolean;
};

export function SecretInput({ kind = 'password', label, style, testID, ...input }: Props) {
  const { t } = useApp();
  const [shown, setShown] = useState(false);
  const words = SECRET_WORDS[kind];
  return (
    <View style={{ flex: 1 }}>
      <Field {...input} label={label} testID={testID} secureTextEntry={!shown} style={[style, styles.room]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(shown ? words.hide : words.show)}
        accessibilityState={{ selected: shown }}
        {...({ 'aria-pressed': shown } as Record<string, boolean>)}
        onPress={() => setShown((v) => !v)}
        testID={testID ? `${testID}-eye` : 'secret-eye'}
        style={(state) => [styles.eye, hoverStyle(state)]}
      >
        {shown ? <EyeOff size={22} color={colors.muted} /> : <Eye size={22} color={colors.muted} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // The box is 56 px high: a 48 px button sits 4 px up from its bottom edge, inside its right end.
  room: { paddingRight: 56 },
  eye: { position: 'absolute', right: 6, bottom: 4, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
