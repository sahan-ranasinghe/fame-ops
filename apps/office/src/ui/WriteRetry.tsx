// The retry rule's Try again (transport/retryRule.ts): a write the person started was dropped on the way, so it may not
// have been saved. Nothing repeats it on its own; this line says so and its Try again presses the same button again (the
// form's own action, with what is in the form now). Web only; the form keeps showing its own error too.
import { useEffect, useState } from "react";
import { type GestureOrigin, onWriteDropped, pressAgain, trackGestures } from "../transport/gesture";

export function WriteRetry() {
  const [dropped, setDropped] = useState<GestureOrigin | null>(null);
  useEffect(() => trackGestures(), []);
  useEffect(() => onWriteDropped((_tool, origin) => setDropped(origin)), []);
  if (!dropped) return null;
  const canPress = !!(dropped.form?.isConnected || dropped.button?.isConnected);
  return (
    <div className="write-retry" role="alert" data-testid="write-retry">
      <span>Fame Fleet didn’t answer, so this may not have been saved.</span>
      {canPress && (
        <button type="button" className="btn small dark" onClick={() => { setDropped(null); pressAgain(dropped); }}>Try again</button>
      )}
      <button type="button" className="btn small" aria-label="Close" onClick={() => setDropped(null)}>×</button>
    </div>
  );
}
