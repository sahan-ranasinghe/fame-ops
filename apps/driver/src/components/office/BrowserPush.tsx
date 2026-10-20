// The mobile website's "This browser" card on Notifications (O4 step 5). The app's notifications come through Android:
// nothing here on a phone. The browser version: BrowserPush.web.tsx.
import type { NotificationSettings } from '@/office/types';

export function BrowserPush(_props: { data: NotificationSettings | null; onSaved: (next: NotificationSettings) => void }) {
  return null;
}
