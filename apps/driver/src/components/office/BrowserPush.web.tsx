// The mobile website's "This browser" card on Notifications (O4 step 5): the office's web push, as the desktop site's
// Settings → Notifications (this browser's state in words, one button: Turn on or Turn off). Turn on = the browser's
// permission → a subscription on the mobile site's worker (scope /m/) → register_web_push; Turn off = unsubscribe →
// remove_web_push. The events below it are the same switches as everywhere. Rules: office/browserPushLogic.ts.
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Notice } from '@/components/ui';
import { browserPushState, currentSubscription, subscribeBrowser, unsubscribeBrowser } from '@/lib/browserPush';
import { browserPushLine, endpointHash, type BrowserPushState } from '@/office/browserPushLogic';
import { useOffice } from '@/office/state';
import { Section } from '@/office/ui';
import type { NotificationSettings } from '@/office/types';
import { useApp } from '@/state/app';

export function BrowserPush({ data, onSaved }: { data: NotificationSettings | null; onSaved: (next: NotificationSettings) => void }) {
  const { t } = useApp();
  const { api } = useOffice();
  const [state, setState] = useState<BrowserPushState | null>(null);
  const [hash, setHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const look = useCallback(async () => {
    setState(await browserPushState());
    const sub = await currentSubscription();
    setHash(sub ? await endpointHash(sub.endpoint) : '');
  }, []);
  useEffect(() => { void look(); }, [look]);

  if (!data || !state) return null;
  const registered = !!hash && data.devices.some((d) => d.endpoint_hash === hash);
  const line = browserPushLine(state, data.push.configured, registered);

  async function run(on: boolean) {
    if (busy || !data) return;
    setBusy(true);
    setProblem(null);
    try {
      if (on) {
        const sub = await subscribeBrowser(data.push.public_key ?? '');
        onSaved(await api.call<NotificationSettings>('register_web_push', { ...sub }));
      } else {
        const endpoint = await unsubscribeBrowser();
        if (endpoint) onSaved(await api.call<NotificationSettings>('remove_web_push', { endpoint }));
      }
      showSnackbar({ text: t(on ? 'web.push.turnedOn' : 'web.push.turnedOff') });
    } catch (e) {
      const why = e instanceof Error ? e.message : '';
      setProblem(t(why === 'blocked' ? 'web.push.blocked' : why === 'no_permission' ? 'web.push.noPermission' : 'web.push.failed'));
    }
    await look();
    setBusy(false);
  }

  return (
    <Section title={t('web.push.title')}>
      <View style={{ gap: 10 }} testID="browser-push">
        <Notice tone={line.tone === 'ok' ? 'info' : line.tone === 'danger' ? 'danger' : line.tone} text={t(`web.push.${line.key}`)} />
        {line.can && (
          <Button
            kind={line.can === 'on' ? 'primary' : 'outline'}
            label={t(line.can === 'on' ? 'web.push.turnOn' : 'web.push.turnOff')}
            busy={busy}
            disabled={busy}
            onPress={() => void run(line.can === 'on')}
            testID={line.can === 'on' ? 'browser-push-on' : 'browser-push-off'}
          />
        )}
        {problem && <Notice tone="danger" text={problem} />}
      </View>
    </Section>
  );
}
