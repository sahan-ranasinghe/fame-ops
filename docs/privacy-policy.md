# Fame Fleet privacy policy

The text of the public page `/privacy` on the office site (https://fame-fleet.pages.dev/privacy), for Fame Global Solutions to review (Charuka) before the store submission. The page and this file say the same; `apps/office/src/screens/Privacy.test.tsx` checks that they stay alike. Change both together.

Last updated 19 October 2026

Fame Fleet is the app and the office site that Fame Global Solutions uses to run its vehicles: drivers get their tasks and record their trips, and the office plans the trips and sees where the vehicles are. It is for Fame Global Solutions' drivers and office staff only. Accounts are made by the company; nobody can sign up.

## What we collect

- **Your location, only while you are on duty.** From the moment you tap Start work (or start a task) until you tap Finish work, or the day ends at the cut-off time, the app records where the vehicle is, about every 5 seconds while it moves and once a minute while it stands. This includes when the app is closed or not in use, because a trip goes on while the phone is in a pocket. Off duty, the app does not follow where you are. A photo you take in the app (the odometer, a receipt, a problem) keeps the place where it was taken, on duty or not, and when you mark a stop Arrived the point where you were is kept with the task. When the office asks "Where are you now?", the app sends one position only if you tap to answer.
- **Photos and videos you take in the app:** the odometer, fuel receipts, the video of a fuel fill, vehicle problems, your profile photo, your licence (front and back) and vehicle photos and documents.
- **Your details:** name, employee code, username, mobile and WhatsApp numbers, an emergency contact, licence number and expiry date, and the language you use. Your PIN is stored only in a form that cannot be read back.
- **Your work:** tasks, the times you started and finished them, odometer readings, fuel, the km driven, reports about the vehicle, when you are not available, and your answers to the office's questions.
- **About the phone, so the office can help when recording stops:** whether location and notifications are on, the battery level, the app version, the phone's make and model, and a token for push notifications.

We do not collect your contacts, messages, calls or files, we show no ads and we never sell data.

## Who sees it

- **The Fame Global Solutions office.** Everyone in the office who works with the fleet sees where the vehicles are, the trips and the tasks. Your mobile number is seen by the office people who plan, approve or manage trips, vehicles or problems, and by the person who asked for a trip you drive. Your emergency contact, licence number and licence photos are seen only by the fleet admin and the people who manage drivers or vehicles.
- **Service providers that run parts of the system for us,** each only for that job: Supabase (the database and file storage), Google (maps, place search, road routes, push notifications through Firebase, and reading the number from an odometer photo), Expo (push notifications), openrouteservice (road routes and the likely road over a gap in a recorded trip) and OpenFreeMap (the free map, when Google's map is not used).
- Nobody else, unless the law requires it.

## How long it is kept

- Location points: 90 days. The last known position of each driver stays until the next one replaces it.
- Where a photo was taken, and where you were when you marked a stop Arrived, stay with the photo and the task.
- The phone's status reports: 30 days.
- Fuel videos: 12 months (or 6 months if the company sets it so).
- Answers to the office's questions: 30 days. Read office notifications: 90 days.
- Tasks, trips, odometer readings, fuel, vehicle reports, their photos and your details are company records and are kept while the company needs them for its vehicles, costs and accounts.

## Your choices

- Location: the app asks for your permission, and you can turn it off in the phone's settings at any time. The app cannot record trips without it, so the office will see that recording has stopped.
- Notifications and the camera: also your choice in the phone's settings.
- To see, correct or remove your data, ask the fleet admin of Fame Global Solutions. Your account is switched off when you leave; the company keeps its records as above.

## Security

Data travels encrypted (HTTPS). Every person signs in with their own account, and the server checks what each account may see on every request. Photos and videos are private files, opened only through short-lived links.

## Questions

Write to the privacy contact e-mail shown on the page (the setting "Privacy contact e-mail" in Settings → Fleet), or ask the fleet admin of Fame Global Solutions. When no e-mail is set, the page shows the office's phone number instead.
