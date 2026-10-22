# In-app voice calls: plan (doc only; Round 4–7, Sahan, 22 October 2026)

What it would take for the office and a driver to call each other inside Fame Fleet (no phone number, no airtime), and what
it would cost. Nothing is built. Prices were read from the providers' own pages on 22 October 2026 (links at the end); check
them again before deciding.

## 1. Today

Every call is a normal phone call: `tel:` and `wa.me` links (the driver's Call office, the office's Call and WhatsApp on
every driver row, the requester's Call driver). It works on every phone, needs no data, costs Fame airtime or WhatsApp data,
and leaves no record in Fame Fleet.

## 2. What an in-app call adds

- A call from the task ("Call the office about this task"), logged on the task (who, when, how long), no phone number shown.
- The office answers on the website (desktop or /m/) or in Office mode, not only on a personal phone.
- It works over Wi-Fi and mobile data, also abroad, never airtime.
- It does NOT replace `tel:`: a driver with no data, or the office reaching a driver whose app is closed and whose phone
  rings nothing, still needs the phone. In-app calls would sit beside the phone call, never instead of it.

## 3. How (WebRTC through a service)

Audio between two apps is WebRTC. Running our own media servers (TURN / SFU) is not worth it for a fleet this size; a
service carries the audio, we keep the calls' records. Three serious options:

| Service | Free each month | Then | Notes |
|---|---|---|---|
| **LiveKit Cloud** | Build plan: 5,000 WebRTC minutes, 50 GB downstream, 100 concurrent connections | Ship plan from $50 a month: 150,000 minutes, 250 GB; then $0.0005 a minute and $0.12 a GB | Open source (can be self-hosted later); an Expo config plugin (`@livekit/react-native-expo-plugin`) |
| **Agora (Voice Calling)** | the first 10,000 RTC minutes | from $0.59 per 1,000 minutes | Mature SDKs; minutes counted per user |
| **Twilio Voice (Browser / app calls)** | $15 trial credit | $0.0040 a minute to make and $0.0040 to receive | Also reaches real phone numbers (PSTN) at extra cost; the most expensive of the three for app-to-app |

**A rough count for Fame:** 20 drivers × 3 calls a day × 3 minutes × 2 people × 26 days ≈ 9,400 participant minutes a
month. Inside LiveKit's free 5,000 only in a quiet month; inside Agora's free 10,000; Twilio about $75 a month for the
same (both legs billed). Recommendation if built: **LiveKit Cloud** (the free plan to pilot; Ship at $50 when it grows;
open source, so no lock-in), with Agora as the alternative on price.

## 4. What the app needs (native: a new build, not an EAS update)

- `react-native-webrtc` (or the service's own React Native SDK built on it) with its Expo config plugin: microphone
  permission, the audio session.
- **Ringing a phone whose app is closed:** an FCM **high-priority data message** wakes the app; Android shows the call
  through **ConnectionService** (`react-native-callkeep` or the SDK's own ringing helper: Stream and LiveKit both document an
  Expo set-up) so it rings like a phone call with Answer / Decline on the lock screen.
- **Android 14 and later:** a foreground service of type `phoneCall` and `microphone` with their permissions
  (`FOREGROUND_SERVICE_PHONE_CALL`, `FOREGROUND_SERVICE_MICROPHONE`), and `USE_FULL_SCREEN_INTENT` for the ringing screen. Google
  Play now grants full-screen intents by default only to apps whose core function is calling or alarms; Fame Fleet would
  have to declare the use in the Play Console (with a video) or ring with a high-priority notification instead.
- The office side (website and /m/): the browser's own WebRTC (no plugin), a ringing notification through the Web Push we
  already have; Office mode the same SDK as the driver app.
- Our server: a small Edge Function that issues a short-lived room token per call (the service's API key stays a secret),
  a `calls` table (who, task, started, answered, ended, length) and its RLS.

## 5. Battery, data and 4G

- Audio only is about 20–50 kbit/s each way (Opus): a 3-minute call is roughly 1–2 MB. Sri Lankan 4G carries it well; on
  3G or a weak signal it breaks up before a phone call does.
- Ringing a closed app depends on FCM and the phone's battery manager. OPPO, Xiaomi and vivo phones are the strictest (our
  test phone, an OPPO, already kills background apps): a call can fail to ring unless the battery steps of Phone setup
  are done, the same steps location sharing needs.
- A call in progress keeps the microphone foreground service on; location sharing goes on beside it.

## 6. Effort (an estimate)

| Piece | Days |
|---|---|
| The token Edge Function, the `calls` table, RLS, audit | 1.5 |
| Driver app: the SDK, the call screen, ringing through ConnectionService and FCM, the native build and its tests | 4 |
| Office: website + /m/ call screen and ringing (Web Push), Office mode the same as the driver app | 3 |
| Call records on the task page, Claude's tool, the tests | 1.5 |
| Testing on the OPPO and two more brands, Play Console declarations | 2 |
| **Total** | **about 12 working days**, one native build (one of the 15 free EAS builds) |

## 7. Recommendation

Do it **after** the pilot and the store release: it needs a new native build and a Play Console declaration (the full-screen
ringing), and `tel:` / WhatsApp already work for every call today. When it is done, start with LiveKit Cloud's free plan,
office ↔ driver only, the phone call kept beside it.

## Sources (read 22 October 2026)

- LiveKit pricing: https://livekit.com/pricing
- Agora pricing: https://www.agora.io/en/pricing/
- Twilio Voice pricing (United States): https://www.twilio.com/en-us/voice/pricing/us
- LiveKit's Expo plugin: https://github.com/livekit/client-sdk-react-native-expo-plugin
- Stream's Expo ringing set-up (CallKeep, the Android foreground-service permissions, the Play Console declaration):
  https://getstream.io/video/docs/react-native/advanced/incoming-calls/ringing-setup/expo/
- react-native-callkeep: https://github.com/react-native-webrtc/react-native-callkeep
