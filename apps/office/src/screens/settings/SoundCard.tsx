// Settings → Notifications → Sounds (Hotfix 2, B; web): the sounds this site plays while it is open when something
// new reaches the person's notification centre: on or off, the volume (saved for the person, every browser), and
// "Test sound" (each kind in turn) with a Play per kind. Pressing Test or Play is the click a browser needs before a
// page may play, so it also turns sounds on for the rest of the visit.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFleet } from "../../app/FleetContext";
import { useInbox } from "../../app/inbox";
import { PATTERNS, type PlayResult, SOUND_KINDS, SOUND_TEXT, type SoundKind, SoundPlayer, soundPrefs } from "../../data/sounds";
import type { NotificationSettings, SoundPrefs } from "../../data/types";
import { asFleetError, errText } from "../../transport/errors";
import { Notice } from "../../ui/basics";
import { useToast } from "../../ui/Toast";
import { setSound } from "./notificationsActions";

/** The volume is saved this long after the slider last moved. */
export const VOLUME_SAVE_MS = 600;

/** What a Test or Play did, in words (nothing when it played). */
export function playText(r: PlayResult): string | null {
  switch (r) {
    case "played":
    case "none":
      return null;
    case "off":
      return "Sounds are off. Turn them on to test them.";
    case "silent":
      return "The volume is at 0: nothing plays.";
    case "locked":
      return "The browser did not let this page play a sound. Click anywhere on the page, then try again.";
  }
}

export function SoundCard({ data, onSaved }: { data: NotificationSettings; onSaved: (next: NotificationSettings) => void }) {
  const { transport } = useFleet();
  const toast = useToast();
  const inbox = useInbox();
  // The page's own player when there is no feed (a test); the feed's otherwise, so a test click unlocks it too.
  const own = useMemo(() => new SoundPlayer(), []);
  const player = inbox?.player ?? own;
  const server = soundPrefs(data.sound);
  const [prefs, setPrefs] = useState<SoundPrefs>(server);
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The server's answer settles what the card shows (after a save, or another browser's change on reload).
  useEffect(() => {
    if (pending.current === null) setPrefs(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.on, server.volume]);

  async function save(change: Partial<SoundPrefs>) {
    setMsg(null);
    try {
      const next = await setSound(transport, change);
      onSaved(next);
      const saved = soundPrefs(next?.sound ?? { ...prefs, ...change });
      inbox?.setSound(saved);
      toast("Saved");
    } catch (e) {
      setMsg(errText(asFleetError(e))[0]);
      setPrefs(server);
    }
  }

  // A volume still waiting to be saved goes when the page closes.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current !== null) void setSound(transport, { volume: pending.current }).then((n) => inbox?.setSound(soundPrefs(n?.sound)), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turn = (on: boolean) => {
    setPrefs((p) => ({ ...p, on }));
    setNote(null);
    void save({ on });
  };
  const slide = (volume: number) => {
    setPrefs((p) => ({ ...p, volume }));
    setNote(null);
    pending.current = volume;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const v = pending.current;
      pending.current = null;
      if (v !== null) void save({ volume: v });
    }, VOLUME_SAVE_MS);
  };
  async function test(kind?: SoundKind) {
    await player.unlock();
    const r = kind ? player.play(kind, prefs) : player.playAll(prefs);
    setNote(playText(r));
  }

  return (
    <div className="card card-b" style={{ display: "grid", gap: 14 }} data-testid="sound-card">
      <h2>Sounds while Fame Fleet is open</h2>
      <p className="muted small" style={{ margin: 0 }}>
        When something new reaches you, this page plays a sound and shows a banner. The sounds play only while the page is
        open in a tab; a closed page tells you through the browser's notifications above.
      </p>
      {msg && <Notice tone="bad">{msg}</Notice>}
      <label className="row" style={{ padding: 0, cursor: "pointer" }}>
        <input type="checkbox" checked={prefs.on} onChange={(e) => turn(e.target.checked)} />
        <span className="grow"><span className="name">Play sounds</span></span>
      </label>
      <label className="field">
        <span>Volume</span>
        <span className="volume">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={prefs.volume}
            disabled={!prefs.on}
            aria-label="Volume"
            onChange={(e) => slide(Number(e.target.value))}
          />
          <span className="num" style={{ minWidth: 48, textAlign: "right" }} data-testid="volume-value">{prefs.volume} %</span>
        </span>
      </label>
      <div className="acts">
        <button type="button" className="btn dark" disabled={!prefs.on} onClick={() => void test()}>Test sound</button>
      </div>
      {note && <Notice tone="info">{note}</Notice>}
      <div className="sound-kinds">
        {SOUND_KINDS.map((k) => (
          <div key={k} className="sound-kind">
            <span className="grow"><span className="name">{SOUND_TEXT[k].label}</span><span className="sub" style={{ display: "block" }}>{SOUND_TEXT[k].text}</span></span>
            <button type="button" className="btn small" disabled={!prefs.on || PATTERNS[k].length === 0} aria-label={`Play ${SOUND_TEXT[k].label.toLowerCase()}`} onClick={() => void test(k)}>Play</button>
          </div>
        ))}
        <div className="sub">Everything else shows a banner without a sound.</div>
      </div>
    </div>
  );
}
