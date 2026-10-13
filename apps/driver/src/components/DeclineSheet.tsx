// "Can't do this task?": the four reasons, an optional word for the office, confirm.
// The office then gives the task to another driver.

import { ReasonSheet } from '@/components/ReasonSheet';
import type { DeclineReason } from '@/lib/api';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';

const REASONS: { value: DeclineReason; label: string }[] = [
  { value: 'vehicle_problem', label: 'task.declineReason.vehicleProblem' },
  { value: 'not_available', label: 'task.declineReason.notAvailable' },
  { value: 'unwell', label: 'task.declineReason.unwell' },
  { value: 'other', label: 'task.declineReason.other' },
];

export function DeclineSheet({ task, onClose, onDeclined }: { task: TaskWithStops | null; onClose: () => void; onDeclined?: () => void }) {
  const { declineTask } = useApp();
  return (
    <ReasonSheet
      visible={task !== null}
      title="task.declineTitle"
      question="task.skipWhy"
      notePlaceholder="task.declineNote"
      confirmLabel="task.declineConfirm"
      subtitle={task?.title}
      reasons={REASONS}
      onConfirm={(reason, note) => {
        if (!task) return;
        declineTask(task, reason, note);
        onDeclined?.();
      }}
      onClose={onClose}
    />
  );
}
