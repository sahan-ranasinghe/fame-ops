// Settings → Notifications → Sounds (/settings/notifications/sounds; Hotfix O2-H2 Part 2): the sounds this site plays
// while it is open, on their own page (one row on Notifications, as the app's "Phone sound and vibration").
import { Loading, Notice } from "../../ui/basics";
import { PageTop } from "../../ui/Page";
import { NOTIF_TEXT } from "./notificationGroups";
import { WebAppOnly } from "./Notifications";
import { SoundCard } from "./SoundCard";
import { useNotifSettings } from "./useNotifSettings";

export default function NotificationSounds() {
  const n = useNotifSettings();
  const top = <PageTop title="Sounds" sub={NOTIF_TEXT.title} backTo="/settings/notifications" />;
  if (__BUILD__ !== "web") return <section className="view">{top}<WebAppOnly /></section>;
  return (
    <section className="view" data-testid="notif-sounds-page">
      {top}
      <div className="stack" style={{ maxWidth: 640 }}>
        {n.err && !n.data && <Notice tone="bad">{n.err}</Notice>}
        {!n.data && !n.err && <Loading>Loading…</Loading>}
        {n.data && <SoundCard data={n.data} onSaved={n.setData} />}
      </div>
    </section>
  );
}
