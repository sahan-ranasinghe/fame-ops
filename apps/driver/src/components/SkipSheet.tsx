// "Skip this stop?": the four reasons, an optional word for the office, confirm.

import { ReasonSheet } from '@/components/ReasonSheet';
import type { TaskStop } from '@/lib/types';
import { type SkipReason, useApp } from '@/state/app';

const REASONS: { value: Exclude<SkipReason, 'not_visited'>; label: string }[] = [
  { value: 'closed', label: 'task.skipReason.closed' },
  { value: 'nobody_there', label: 'task.skipReason.nobodyThere' },
  { value: 'not_needed', label: 'task.skipReason.notNeeded' },
  { value: 'other', label: 'task.skipReason.other' },
];

export function SkipSheet({ stop, onClose }: { stop: TaskStop | null; onClose: () => void }) {
  const { skipStop } = useApp();
  return (
    <ReasonSheet
      visible={stop !== null}
      title="task.skipTitle"
      question="task.skipWhy"
      notePlaceholder="task.skipNote"
      confirmLabel="task.skipConfirm"
      subtitle={stop?.place_name}
      reasons={REASONS}
      onConfirm={(reason, note) => { if (stop) skipStop(stop, reason, note); }}
      onClose={onClose}
    />
  );
}
