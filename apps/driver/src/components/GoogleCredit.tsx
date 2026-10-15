// "Google Maps" under the name of a stop that is a Google place (Phase 6, Part 5): Google's
// attribution rule for its place names shown outside its map. Never translated (Google's rule).
import { Txt } from './ui';

export function GoogleCredit({ show }: { show: boolean | null | undefined }) {
  if (!show) return null;
  return <Txt variant="small" accessibilityLanguage="en">Google Maps</Txt>;
}
