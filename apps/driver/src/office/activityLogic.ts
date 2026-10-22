// Round 3 (docs/phase8-plan.md §30, item 3): the Activity log's routine actions, the pattern of Google Workspace's and
// GitHub's audit logs: watching drivers, reading a notification, loading a map and the like are hidden by default; a "Show
// routine actions" switch asks activity_log for them too (include_routine); a change, a refusal or a failure always
// shows. Pure (scripts/test-who-drives.ts).

/** activity_log's input: the days, the person when searched, the routine actions only when the switch is on, the page. */
export function activityArgs(p: { from: string; to: string; person?: string; routine?: boolean; cursor?: string; limit?: number }): Record<string, unknown> {
  const person = p.person?.trim();
  return {
    from: p.from,
    to: p.to,
    limit: p.limit ?? 50,
    ...(person ? { person } : {}),
    ...(p.routine ? { include_routine: true } : {}),
    ...(p.cursor ? { cursor: p.cursor } : {}),
  };
}

/** A routine row is shown quieter (no bold title) unless it was refused or failed: those always stand out. */
export const quietRow = (e: { routine?: boolean; outcome: string }): boolean => !!e.routine && e.outcome === 'done';

/**
 * A row's outcome chip (Sahan, 22 October 2026): almost every row is done, so "Done" is not said on each; Refused, Failed and
 * In progress keep their chip (they are the rows to look at).
 */
export const outcomeChipShown = (outcome: string): boolean => outcome !== 'done';
