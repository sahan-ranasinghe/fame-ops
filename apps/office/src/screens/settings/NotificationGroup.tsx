// Settings → Notifications → a group (/settings/notifications/:group; Hotfix O2-H2 Part 2, the app's group screen in the
// site's look): a switch per event this person can get, a short title and at most one grey line each. A switch saves at
// once; a failed save turns it back and says so in the toast (useNotifSettings). An unknown group, or one with nothing
// for this person, says so.
import { useParams } from "react-router";
import { Empty, Loading, Notice } from "../../ui/basics";
import { PageTop } from "../../ui/Page";
import { eventDef, NOTIF_TEXT } from "./notificationGroups";
import { groupWords, SwitchLine, WebAppOnly } from "./Notifications";
import { useNotifSettings } from "./useNotifSettings";

export default function NotificationGroup() {
  const { group = "" } = useParams();
  const n = useNotifSettings();
  const w = groupWords(group);
  const shown = n.groups.find((g) => g.key === group);
  const top = <PageTop title={shown || w.title !== "Other" ? w.title : NOTIF_TEXT.title} sub={w.sub ?? NOTIF_TEXT.title} backTo="/settings/notifications" />;

  if (__BUILD__ !== "web") return <section className="view">{top}<WebAppOnly /></section>;
  return (
    <section className="view" data-testid="notif-group">
      {top}
      <div className="stack" style={{ maxWidth: 640 }}>
        {n.err && !n.data && <Notice tone="bad">{n.err}</Notice>}
        {!n.data && !n.err && <Loading>Loading…</Loading>}
        {n.data && !shown && <Empty>{NOTIF_TEXT.noEvents}</Empty>}
        {n.paused && shown && <p className="muted small" style={{ margin: 0 }}>{NOTIF_TEXT.pausedNote}</p>}
        {shown && (
          <div className="card card-b set-rows">
            {shown.events.map((e) => {
              const def = eventDef(e.event);
              return (
                <SwitchLine
                  key={e.event}
                  title={def ? def.title : e.label}
                  text={def ? def.text : e.text}
                  on={e.enabled}
                  onChange={(on) => void n.setEvent(e.event, on)}
                  disabled={n.paused}
                  testId={`notif-ev-${e.event}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
