// Choose the vehicle I am driving ("Change" on the Today screen).

import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronLeft } from '@/components/icons';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Mono, Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function VehicleScreen() {
  const app = useApp();
  const { t, vehicles, vehicle } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  if (!app.me) return <Redirect href="/login" />;

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 24, gap: 12 }}
        refreshControl={<RefreshControl refreshing={app.refreshing} onRefresh={app.refresh} colors={[colors.ink]} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <Txt variant="title" size={26} style={{ flex: 1 }}>{t('vehicle.title')}</Txt>
        </View>

        {vehicles.length === 0 && <Txt variant="muted" style={{ padding: 8 }}>{t('vehicle.none')}</Txt>}
        {vehicles.map((item) => {
          const mine = item.id === vehicle?.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: mine }}
              onPress={() => {
                app.chooseVehicle(item.id);
                router.back();
              }}
            >
              <Card style={[styles.row, mine && { borderColor: colors.ink, borderWidth: 2.5 }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Mono size={20} bold>{item.reg_no}</Mono>
                  <Txt variant="muted">
                    {[item.make_model, item.seats ? t('common.seats', { n: item.seats }) : null].filter(Boolean).join(' · ')}
                  </Txt>
                  {item.in_garage && <Txt variant="strong" size={15} color={colors.amberText}>{t('vehicle.inGarage')}</Txt>}
                </View>
                {mine && <Check size={26} color={colors.ink} strokeWidth={3} />}
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 84 },
});
