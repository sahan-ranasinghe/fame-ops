// The clock (Material 3's time picker, Google Calendar's; 21 October 2026), the site's twin of the app's
// components/patterns/TimeDial.tsx: the time on top (its hours or its minutes clicked to choose which the dial sets), a
// 24-hour dial (outer ring 00–11, inner 12–23), then the minutes, any minute by dragging or clicking on the face; letting
// go of an hour goes to the minutes. The arrow keys move it by one. The math is dialLogic.ts (the same file as the app's).
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { type DialMode, dialLabels, hhmm, hourAt, minuteAt, partsOf, placeOf, pointOf } from "./dialLogic";

const SIZE = 264;
const C = SIZE / 2;
const OUTER = 108;
const INNER = 72;

export function TimeDial({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const { h, m } = partsOf(value);
  const [mode, setMode] = useState<DialMode>("hour");
  const dragging = useRef(false);
  const svg = useRef<SVGSVGElement>(null);

  const setAt = (e: PointerEvent<SVGSVGElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const x = ((e.clientX - box.left) / box.width) * SIZE;
    const y = ((e.clientY - box.top) / box.height) * SIZE;
    if (mode === "hour") onChange(hhmm(hourAt(x, y, C, C, OUTER, INNER), m));
    else onChange(hhmm(h, minuteAt(x, y, C, C)));
  };
  const key = (e: KeyboardEvent) => {
    const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    onChange(mode === "hour" ? hhmm(h + d, m) : hhmm(h, m + d));
  };

  const sel = placeOf(mode, mode === "hour" ? h : m, OUTER, INNER);
  const knob = pointOf(sel.angle, sel.radius, C, C);
  return (
    <div className="tdial" data-testid="time-clock">
      <div className="tdial-top">
        <button type="button" className={`tdial-part mono${mode === "hour" ? " on" : ""}`} aria-pressed={mode === "hour"} onClick={() => setMode("hour")} data-testid="time-part-hour">{String(h).padStart(2, "0")}</button>
        <span className="tdial-colon mono">:</span>
        <button type="button" className={`tdial-part mono${mode === "minute" ? " on" : ""}`} aria-pressed={mode === "minute"} onClick={() => setMode("minute")} data-testid="time-part-minute">{String(m).padStart(2, "0")}</button>
      </div>
      <svg
        ref={svg}
        className="tdial-face"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="slider"
        tabIndex={0}
        aria-label={mode === "hour" ? "Hour" : "Minute"}
        aria-valuetext={hhmm(h, m)}
        aria-valuenow={mode === "hour" ? h : m}
        aria-valuemin={0}
        aria-valuemax={mode === "hour" ? 23 : 59}
        onKeyDown={key}
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); setAt(e); }}
        onPointerMove={(e) => { if (dragging.current) setAt(e); }}
        onPointerUp={() => { dragging.current = false; if (mode === "hour") setMode("minute"); }}
        data-testid="time-dial"
      >
        <circle cx={C} cy={C} r={C} className="tdial-bg" />
        <line x1={C} y1={C} x2={knob.x} y2={knob.y} className="tdial-hand" />
        <circle cx={C} cy={C} r={4} className="tdial-dot" />
        <circle cx={knob.x} cy={knob.y} r={20} className="tdial-knob" />
        {dialLabels(mode).map((l) => {
          const p = pointOf(placeOf(mode, l.value, OUTER, INNER).angle, l.inner ? INNER : OUTER, C, C);
          const on = mode === "hour" ? l.value === h : l.value === m;
          return (
            <text key={l.value} x={p.x} y={p.y} className={`tdial-label${l.inner ? " inner" : ""}${on ? " on" : ""}`} textAnchor="middle" dominantBaseline="central">{l.text}</text>
          );
        })}
      </svg>
    </div>
  );
}
