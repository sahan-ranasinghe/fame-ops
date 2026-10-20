// Office mode (Phase 8, O2, item 7): the pieces the People screens share: the search box (the Issues list's), a secret
// shown once (a set-password link) with Share (React Native's share sheet, so it goes by WhatsApp; never logged), the
// permission picker (the presets as chips, then one row per permission; view locked while another needs it; never a
// role name) and the switch of the quick settings. The rules: office/peopleLogic.ts.

import { Pressable, Share, StyleSheet, TextInput, View } from 'react-native';

import { Check, Search, Square, X } from '@/components/icons';
import { Button, Txt } from '@/components/ui';
import { type Preset, PRESET_KEYS, presetOf, togglePermission, viewLocked } from '@/office/peopleLogic';
import { type Permission, PERMISSIONS, PRESETS } from '@/office/permissions';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

export function SearchBox({ value, onChange, onSubmit, placeholder, clearLabel }: {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  clearLabel: string;
}) {
  const { language } = useApp();
  return (
    <View style={styles.search}>
      <Search size={20} color={colors.muted} strokeWidth={2.2} />
      <TextInput
        accessibilityRole="search"
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9aa0a6"
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        autoCorrect={false}
        autoCapitalize="none"
        style={[styles.searchInput, { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }]}
      />
      {value.length > 0 && (
        <Pressable accessibilityRole="button" accessibilityLabel={clearLabel} onPress={() => onChange('')} style={styles.clear}>
          <X size={20} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
      )}
    </View>
  );
}

/** A link shown once: the words, the link itself (selectable), Share, and the hint. Nothing here is logged. */
export function SecretCard({ title, value, hint, shareText, shareLabel }: { title: string; value: string; hint: string; shareText: string; shareLabel: string }) {
  return (
    <View style={styles.secret}>
      <Txt variant="strong" size={17}>{title}</Txt>
      <Txt variant="body" size={15} selectable style={{ fontFamily: fonts.mono }}>{value}</Txt>
      <Button kind="dark" label={shareLabel} onPress={() => void Share.share({ message: shareText }).catch(() => undefined)} style={{ minHeight: 56 }} />
      <Txt variant="small">{hint}</Txt>
    </View>
  );
}

/** The presets as chips, then every permission as a row with its tick; the person's permissions, never a role name. */
export function PermissionPicker({ value, onChange, disabled = false }: { value: Permission[]; onChange: (next: Permission[]) => void; disabled?: boolean }) {
  const { t } = useApp();
  const current = presetOf(value);
  const locked = viewLocked(value);
  const chip = (key: Preset | 'all', label: string, list: readonly Permission[]) => {
    const on = current === key;
    return (
      <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on, disabled }} disabled={disabled} onPress={() => onChange([...list])} style={[styles.preset, on && styles.presetOn]}>
        <Txt variant="strong" size={15} color={on ? '#ffffff' : colors.ink}>{label}</Txt>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: 10 }}>
      <Txt variant="label" color={colors.muted}>{t('office.people.quickPicks').toUpperCase()}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PRESET_KEYS.map((k) => chip(k, t(`office.preset.${k}`), PRESETS[k].permissions))}
        {chip('all', t('office.people.presetAdmin'), PERMISSIONS)}
      </View>
      <Txt variant="label" color={colors.muted}>{t('office.people.permissions').toUpperCase()}</Txt>
      <View style={{ gap: 6 }}>
        {PERMISSIONS.map((p) => {
          const lock = p === 'view' && locked;
          const on = value.includes(p) || lock;
          return (
            <Pressable
              key={p}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: disabled || lock }}
              disabled={disabled || lock}
              onPress={() => onChange(togglePermission(value, p))}
              style={[styles.permRow, lock && { opacity: 0.6 }]}
            >
              {on ? <Check size={24} color={colors.blue} strokeWidth={2.6} /> : <Square size={24} color={colors.muted} strokeWidth={2} />}
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="strong" size={16}>{t(`office.permission.${p}`)}</Txt>
                <Txt variant="small">{lock ? t('office.people.viewLocked') : t(`office.permissionText.${p}`)}</Txt>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Txt variant="small">{t('office.people.presetsHint')}</Txt>
    </View>
  );
}

/** The designs' switch (blue on, grey off). */
export function Toggle({ on, onPress, disabled = false, label }: { on: boolean; onPress: () => void; disabled?: boolean; label: string }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={onPress} hitSlop={8} style={[styles.toggle, on && { backgroundColor: colors.blue }, disabled && { opacity: 0.6 }]}>
      <View style={[styles.knob, on && { alignSelf: 'flex-end' }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.card, paddingLeft: 14, paddingRight: 4 },
  searchInput: { flex: 1, fontSize: 17, color: colors.ink, minHeight: 48, paddingVertical: 8 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  secret: { backgroundColor: colors.card, borderColor: colors.amber, borderWidth: 1.5, borderRadius: 18, padding: 16, gap: 12 },
  preset: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  presetOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 },
  toggle: { width: 52, height: 30, borderRadius: 15, backgroundColor: '#c9c5bb', padding: 3, justifyContent: 'center' },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.card },
});
