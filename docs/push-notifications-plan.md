# Push notifications and sounds for Fame Driver (plan, needs a new build)

Status: plan only, written 8 October 2026. Nothing here is built yet. Both
parts need a new Android build, because they add native pieces (Firebase
Messaging, a bundled sound file, a notification channel with a custom sound).
Raise `version` in `apps/driver/app.json` first so that the current preview
build (1.0.0) does not receive code it cannot run.

## 1. Push when the app is closed: new, changed and cancelled tasks

Today the app only learns about tasks while it is running (Realtime on the
`tasks` table, plus a refresh when it comes to the front). Push reaches a
phone whose app is closed.

### How it works

```
office connector (create_task / reassign_task / cancel_task)
        │  insert / update on public.tasks
        ▼
trigger tasks_notify_push  ──►  pg_net POST  ──►  Edge Function push-task
                                                      │  reads device_tokens of the driver
                                                      ▼
                                              Expo Push API (exp.host/--/api/v2/push/send)
                                                      │  Expo talks to FCM with the
                                                      ▼  Firebase server key we upload to EAS
                                               the driver's phone (FCM) → Fame Driver
```

- The app registers once per sign-in: `Notifications.getExpoPushTokenAsync({ projectId })`
  gives an `ExponentPushToken[...]`; the app stores it in a new table
  `device_tokens (employee_id, token, platform, device_model, updated_at)`
  with an RLS policy "a driver writes only their own rows". Sign-out deletes
  the row (the queue already has an op type we can reuse for this).
- A database trigger on `public.tasks` (after insert, after update of
  `employee_id`, `start_at`, `vehicle_id`, `status` to `cancelled`) calls the
  Edge Function `push-task` through `pg_net` with the task id and the kind of
  change (`new`, `changed`, `cancelled`, and `removed` for the previous
  driver when a task is reassigned). The trigger fires for connector writes
  only (role `service_role`), never for the driver's own updates.
- `push-task` builds the message in the driver's language, sends it to Expo's
  push API with the right Android channel (`tasks-new`, `tasks-changed`,
  `tasks-cancelled`) and records the result in `push_log`. Invalid tokens
  (`DeviceNotRegistered`) are deleted.
- Tapping the notification opens the task (`famedriver://task/<id>` through
  expo-router's deep linking).
- Realtime stays as it is: when the app is open it already updates in seconds.

### What Sahan must set up

Firebase (console.firebase.google.com, Google account of Fame Global):

1. Create a Firebase project "Fame Driver" (Analytics can stay off).
2. Add an Android app with package name `com.fameglobal.driver`. Download
   `google-services.json`.
3. Project settings → Cloud Messaging: make sure the Firebase Cloud Messaging
   API (V1) is enabled.
4. Project settings → Service accounts → Generate new private key. This JSON
   file is the FCM V1 credential Expo needs.

EAS (expo.dev, organisation `fame-global`, project `fame-driver`):

5. Put `google-services.json` in `apps/driver/` and point `app.json` at it:
   `"android": { "googleServicesFile": "./google-services.json" }`. The file
   is not a secret (it only identifies the Firebase project), but keep it
   out of git anyway: add it to `.gitignore` and upload it as an EAS file
   secret (`eas secret:create --scope project --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json`),
   then reference it in `app.json` as `./google-services.json` and in
   `eas.json` with `"env": { "GOOGLE_SERVICES_JSON": ... }`; the README will
   carry the exact steps when this is built.
6. Upload the service-account key to EAS: `eas credentials` → Android →
   production/preview → Google Service Account → "Set up a Google Service
   Account Key for Push Notifications (FCM V1)" and pick the JSON from step 4.
7. Build again: `eas build --profile preview --platform android`.

Supabase (needs Sahan's go-ahead, as always):

8. Migration: `device_tokens`, `push_log`, the trigger, and
   `create extension pg_net`. The trigger needs the function URL and a shared
   secret; both go into Vault (`vault.create_secret`) so nothing is in the
   migration file.
9. Deploy the Edge Function `push-task` (`--no-verify-jwt`; it checks the
   shared secret from the trigger instead).
10. Secrets: `PUSH_SHARED_SECRET` (random, 32+ characters), set with
    `npx supabase secrets set` and stored in Vault for the trigger.

Nothing else is needed on the phones: Expo's push service talks to FCM with
the key from step 6.

### Limits to know

- Expo push: free, fair-use limit of about 600 notifications per second per
  project, far above our needs.
- A phone that has killed the app (the OPPO problem) still receives push:
  FCM wakes the app's receiver. On ColorOS the "Allow background activity"
  setting also affects whether the notification is shown promptly.
- Push is best effort; the Today screen remains the source of truth and
  refreshes on open.

## 2. Sounds: a PickMe-style ring for a new task, short sounds for start and finish

- Android plays a custom sound only from a notification channel created with
  that sound. Channels cannot be changed after they are created, so the new
  channels get new ids (`tasks-new-v2` and so on) and the sound files are
  bundled with the build.
- Files: `assets/sounds/new-task.wav` (about 4 s, rising ring like a ride
  request, loud enough for a van), `assets/sounds/task-started.wav` and
  `assets/sounds/task-done.wav` (short, under 1 s). Sahan or the boss chooses
  the actual sounds; royalty-free sources are fine (Pixabay, Freesound CC0).
- `app.json`: `expo-notifications` plugin option
  `"sounds": ["./assets/sounds/new-task.wav", "./assets/sounds/task-started.wav", "./assets/sounds/task-done.wav"]`.
- `lib/notifications.ts`: channel `tasks-new-v2` with `sound: 'new-task.wav'`,
  importance MAX, vibration pattern `[0, 500, 200, 500, 200, 500]`, bypass Do
  Not Disturb off (a driver can mute at night). The push payload names this
  channel, and the in-app Realtime notification uses it too.
- Task started / completed: `expo-audio` (new native module) plays the short
  sounds from the app itself when the driver taps Start task and Save &
  finish task; no notification is needed for those.
- The Permissions screen gets a "Test sound" button so a driver can check the
  volume.

### What Sahan must set up for sounds

1. Pick the three sound files (WAV or MP3, mono, under 500 KB each) and put
   them in `apps/driver/assets/sounds/`.
2. `npx expo install expo-audio`.
3. New build (same build as part 1).

## Order of work when the boss says go

1. Firebase + EAS credentials (Sahan, about 30 minutes).
2. Migration + `push-task` function + app changes (one working day).
3. Sounds (half a day, mostly choosing the files).
4. One preview build; test on the OPPO phone with the app closed and the
   phone locked for 30 minutes.
