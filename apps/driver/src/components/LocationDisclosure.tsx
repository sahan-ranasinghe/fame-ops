// Part 6 (store readiness): the prominent disclosure, a full screen of its own before Android's location question (lib/
// disclosure.ts). What is collected, why, that it goes on in the background while on duty, who sees it and for how long,
// the privacy policy, and Agree / Not now. Not now (or back) asks Android nothing.

import { Linking, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapPin } from '@/components/icons';
import { Button, Txt } from '@/components/ui';
import { PRIVACY_URL } from '@/config';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function LocationDisclosure({ visible, onAgree, onClose }: { visible: boolean; onAgree: () => void; onClose: () => void }) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.page}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 28, gap: 16 }}>
          <View style={styles.icon}>
            <MapPin size={32} color={colors.amber} />
          </View>
          <Txt variant="title">{t('disclosure.title')}</Txt>
          <Txt size={18}>{t('disclosure.body')}</Txt>
          <View style={{ gap: 10 }}>
            {(['offDuty', 'whoSees', 'settings'] as const).map((k) => (
              <View key={k} style={{ flexDirection: 'row', gap: 10 }}>
                <Txt variant="strong">•</Txt>
                <Txt variant="muted" size={16} style={{ flex: 1 }}>{t(`disclosure.${k}`)}</Txt>
              </View>
            ))}
          </View>
          <Txt variant="strong" color={colors.blue} onPress={() => void Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
            {t('common.privacy')}
          </Txt>
          <Txt variant="muted" size={15}>{t('disclosure.next')}</Txt>
        </ScrollView>
        <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
          <Button label={t('disclosure.agree')} onPress={onAgree} />
          <Button label={t('disclosure.notNow')} kind="outline" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  icon: { width: 60, height: 60, borderRadius: 16, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  actions: { paddingHorizontal: 20, paddingTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.page },
});
