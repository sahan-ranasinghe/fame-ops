// "Resume draft from HH:MM · Discard" above a form that has an unfinished draft.
import type { DraftControls } from "../data/drafts";
import { clock } from "../lib/format";

export function DraftBanner({ draft }: { draft: DraftControls }) {
  if (!draft.saved) return null;
  return (
    <div className="draft-banner" role="status" data-testid="draft-banner">
      <span>Resume draft from {clock(draft.saved.at)}</span>
      <span className="acts">
        <button type="button" className="btn small dark" onClick={draft.resume}>Resume</button>
        <button type="button" className="btn small" onClick={draft.discard}>Discard</button>
      </span>
    </div>
  );
}
