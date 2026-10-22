// The browser's copy of lib/arrival.ts (the mobile website's build; the driver's screens reach it only through the design
// pages of src/design, the e2e build). The arrival notification is the phone's own background location task, which needs
// the phone's queue (sync, expo-sqlite, no web bundle); a browser has neither, so "this task is on screen" quiets nothing.

/** The task whose screen is in front: nothing to quiet in a browser. */
export function setTaskOnScreen(_taskId: string | null): void {
  // No background arrival notification in a browser.
}
