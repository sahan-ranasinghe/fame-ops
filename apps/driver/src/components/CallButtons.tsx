// Call and WhatsApp buttons (Hotfix 2, F and K). Each opens the dialler with the number filled (tel:) or a WhatsApp
// chat (wa.me); the driver presses Call there. Nothing dials by itself. Who to call and the numbers: lib/contacts.ts.

import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { MessageCircle, Phone } from '@/components/icons';
import { Txt } from '@/components/ui';
import type { CallKind, CallTarget } from '@/lib/contacts';
import { colors } from '@/theme';
import { useApp } from '@/state/app';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

/**
 * One row per person: "Call requester" with the name and number under it, and WhatsApp beside it. `callHidden`: the
 * kinds whose Call is shown elsewhere on the screen (the task screen's Call contact beside Navigate) keep only WhatsApp.
 * `compact` (the Today card): smaller rows.
 */
export function CallButtons({ calls, compact = false, callHidden = [] }: { calls: CallTarget[]; compact?: boolean; callHidden?: CallKind[] }) {
  const { t } = useApp();
  if (calls.length === 0) return null;
  return (
    <View style={{ gap: compact ? 8 : 10 }}>
      {calls.map((c) => {
        const hideCall = callHidden.includes(c.kind);
        const who = [c.name, c.display].filter(Boolean).join(' · ');
        return (
          <View key={`${c.kind}:${c.tel}`} style={styles.row}>
            {hideCall ? (
              <View style={[styles.info, compact && styles.compact]}>
                <Txt variant="small" numberOfLines={1}>{t(c.label)}</Txt>
                <Txt variant="strong" size={compact ? 15 : 16} numberOfLines={1}>{who}</Txt>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t(c.label)} ${who}`}
                onPress={() => open(c.tel)}
                style={({ pressed }) => [styles.call, compact && styles.compact, pressed && { opacity: 0.8 }]}
              >
                <Phone size={compact ? 20 : 22} color={colors.ink} strokeWidth={2.4} />
                <View style={{ flex: 1 }}>
                  <Txt variant="strong" size={compact ? 16 : 17} numberOfLines={1}>{t(c.label)}</Txt>
                  <Txt variant="small" numberOfLines={1}>{who}</Txt>
                </View>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('call.whatsapp')} ${who}`}
              onPress={() => open(c.whatsapp)}
              style={({ pressed }) => [styles.whatsapp, compact && styles.compact, pressed && { opacity: 0.8 }]}
            >
              <MessageCircle size={compact ? 20 : 22} color={colors.ink} strokeWidth={2.4} />
              {!compact && <Txt variant="strong" size={15}>{t('call.whatsapp')}</Txt>}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/** "Approved by Palitha · 10:42" with a round Call button (the approver, else the office; none without a number). */
export function ApprovedLine({ text, call }: { text: string; call: CallTarget | null }) {
  const { t } = useApp();
  return (
    <View style={styles.approved}>
      <Txt variant="strong" color={colors.blue} style={{ flex: 1 }}>{text}</Txt>
      {call && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t(call.label)} ${call.display}`}
          onPress={() => open(call.tel)}
          hitSlop={6}
          style={({ pressed }) => [styles.round, pressed && { opacity: 0.8 }]}
        >
          <Phone size={20} color="#ffffff" strokeWidth={2.4} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  call: {
    flex: 1,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  info: { flex: 1, minHeight: 60, justifyContent: 'center', paddingHorizontal: 4 },
  whatsapp: {
    minHeight: 60,
    minWidth: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  compact: { minHeight: 52 },
  approved: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
});
