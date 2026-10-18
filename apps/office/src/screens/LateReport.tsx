// Part 3b (H4): the driver's own "Running late 15 min · said 08:52" (report_running_late), an amber line wherever a task
// is shown: the task page and the board's card (Live has its own, W1's). Nothing when the driver said nothing.
import type { LateReport } from "../data/types";

export function LateReportLine({ late, testId = "late-report" }: { late?: LateReport | null; testId?: string }) {
  if (!late) return null;
  return <span className="late-line" data-testid={testId} title="The driver said so in the app">{late.text}</span>;
}
