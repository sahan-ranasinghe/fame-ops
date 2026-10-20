// The keys lib/kv keeps (the app's SQLite kv-store, the website's localStorage): one list for both.
export const KEYS = {
  me: 'me',
  language: 'language',
  sharing: 'sharing',
  lastFlush: 'lastFlush',
  tasks: 'cache.tasks',
  vehicles: 'cache.vehicles',
  reports: 'cache.reports',
  permissionsSeen: 'permissionsSeen',
  /** Part 6: who agreed to the location disclosure on this phone, and when ({employeeId, at}). */
  locationDisclosure: 'location.disclosure',
  /** When the location service last delivered a position (ms). */
  lastFix: 'tracking.lastFix',
  /** The GPS filter's state and the km counters (see lib/tracking.ts). */
  track: 'tracking.track',
  /** When the "sharing has stopped" notification is due to fire (ms). */
  watchdogAt: 'tracking.watchdogAt',
  /** When the app last looked for a code update (ms). */
  lastUpdateCheck: 'updates.lastCheck',
  /** An update was downloaded but not started yet (a task was running or something was waiting to upload). */
  updateDownloaded: 'updates.downloaded',
  /** The Expo push token this phone registered with the office. */
  pushToken: 'push.token',
  /** The shift nudge's time and days, as the office set them (Phase 6). */
  shift: 'shift.settings',
  /** The settings the nudge is scheduled with right now (JSON), so it is not rescheduled on every run. */
  shiftArmed: 'shift.armed',
  /** "Upload videos on Wi-Fi only" (Me tab). */
  videoWifiOnly: 'video.wifiOnly',
  /** The upload backoff after a failed connection (sync/engine.ts). */
  backoff: 'sync.backoff',
  /** The office is watching this driver until here (ms; the heartbeat's answer): uploads every 10 s while moving. */
  watchedUntil: 'tracking.watchedUntil',
  /** The last heartbeat while on duty ({at, sessionId}): over 3 minutes to the next one means the phone stopped the app. */
  lastBeat: 'phone.lastBeat',
  /** When the last heartbeat was built (the location task sends one when the JS timers are frozen in the background). */
  lastHeartbeatAt: 'heartbeat.lastAt',
  /** Those gaps, the last 7 days (lib/phoneSetup.ts), and when the driver last tapped Done on Me → Phone setup (same key as the old card's Done). */
  phoneGaps: 'phone.gaps',
  phoneSetupDoneAt: 'phone.setupDoneAt',
  /** The stops the arrival nudge already spoke about (lib/arrival.ts). */
  arrivalNudged: 'arrival.nudged',
  /** The watchdog: when it last restarted the location service (ms), and how often since the last heartbeat. */
  lastRestartAt: 'tracking.lastRestartAt',
  locationRestarts: 'tracking.locationRestarts',
  /** Phase 7: the server ended this driver's duty (the cut-off or the office): {at, reason}, for the notice on Today. */
  dutyEnded: 'duty.ended',
  /** Phase 7: the vehicle the driver held last (off duty the logs, fuel and reports still go to it). */
  lastVehicle: 'duty.lastVehicle',
  /** Phase 7: the newest "taken over" banner the driver closed (the assignment id), so it does not come back. */
  takenSeen: 'duty.takenSeen',
  /** Phase 7 §5: the driver's own photo kept on the phone ({photoId, uri}), so Me shows it at once and offline. */
  profilePhoto: 'me.profilePhoto',
  /** Phase 7 §28: the held vehicle's documents as last read ({vehicleId, rows}): the expiries show offline; the files never stay. */
  documents: 'docs.lastRead',
  /** Part 6: the map report waiting to reach the server ({google_ok, reason, at}) and the last one it took (lib/mapEngine.ts). */
  mapReportPending: 'map.reportPending',
  mapReported: 'map.reported',
  /** Phase 7 §13: our places as last read ({at, rows}), so Start a trip offers them with no connection. */
  tripPlaces: 'trips.places',
  /** Phase 7 §13: our places the driver picked for a trip, newest first (offered again offline). */
  tripPicked: 'trips.picked',
  /** Phase 7 §13: a queued trip's first stop, the phone's id → the server's ({local: server}); stop changes go to the server's. */
  tripStopIds: 'trips.stopIds',
  /** Hotfix 2 (F, K): who to call about each task, as last read ({taskId: {at, updatedAt, contacts}}): the buttons show offline. */
  taskContacts: 'cache.taskContacts',
  /** Hotfix 2 (F): Me's Call office and Call fleet admin, as last read ({at, contacts}). */
  officeContacts: 'cache.officeContacts',
  /** Hotfix 2 (I): each task as the driver last saw it ({taskId: SeenCopy}): a changed task shows what changed. */
  taskSeen: 'cache.taskSeen',
  /** Hotfix 2 (I): what each task's newest "Task changed" push named ({taskId: PushChanges}), until the driver opens it. */
  pushChanges: 'cache.pushChanges',
  /** Part 3b (H3): the office's questions to this driver as last read, with the answers given on the phone (AskRow[]). */
  asks: 'cache.asks',
  /** Part 3b (G): the licence photos kept on the phone ({front?, back?}: {photoId, uri}), so Me shows them at once and offline. */
  licencePhotos: 'me.licencePhotos',
  /** Part 3b (G): Me's "This month" as last read ({month: "2026-10", tasks, km}). */
  monthTotals: 'me.monthTotals',
  /** Part 3b (H1): my availability entries as last read (UnavailabilityRow[]): Me → Availability shows them offline. */
  availability: 'cache.availability',
  /** When the refused points were last put back in line (ms), and for which app update. */
  rejectedRetryAt: 'sync.rejectedRetryAt',
  rejectedRetryUpdate: 'sync.rejectedRetryUpdate',
} as const;
