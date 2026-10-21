// The time sheet's rules (docs/ui-patterns.md §4), pure: what a whole time is. The clock's math is dialLogic.ts. No
// quick-time chips since the boss's review (21 October 2026): the clock only.

export const isHHMM = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
