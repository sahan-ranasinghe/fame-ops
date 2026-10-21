// Round 2 (21 October 2026): one stop's progress line on the task screen: "Planned 10:30 · Arrived 10:52 · Left 11:40",
// then "22 min late" (amber) / "8 min early" or "on time" (green), or "about 12:10" for a stop still to come
// (lib/stopProgressWords.ts over the shared rule lib/stopProgress.ts).

import { Txt } from '@/components/ui';
import type { StopProgress } from '@/lib/stopProgress';
import { progressWords } from '@/lib/stopProgressWords';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function StopProgressLine({ progress, corrected = false }: { progress: StopProgress | undefined; corrected?: boolean }) {
  const { t } = useApp();
  const words = progressWords(t, progress, corrected);
  if (words.line === '' && !words.delta && !words.about) return null;
  return (
    <Txt variant="small" testID={progress ? `progress-${progress.id}` : undefined}>
      {words.line}
      {words.delta && (
        <Txt variant="strong" size={14} color={words.delta.late ? colors.amberText : colors.green}>{`${words.line ? ' · ' : ''}${words.delta.text}`}</Txt>
      )}
      {words.about && <Txt variant="strong" size={14} color={colors.blue}>{`${words.line || words.delta ? ' · ' : ''}${words.about}`}</Txt>}
    </Txt>
  );
}
