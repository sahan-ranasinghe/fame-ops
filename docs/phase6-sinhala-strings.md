# Phase 6: the driver app's new strings, for the Sinhala check

15 October 2026. Every key Phase 6 added to `apps/driver/src/i18n/en.json` (Parts 2 to 5: the
shift nudge, the Fuel tab and its video, the Phone setup card, navigation and the arrival nudge,
the Google task map), with the Sinhala now in `si.json` (written by Claude Code during the work;
nothing is left in English, no key changed or removed). Please read the Sinhala column with the
boss or a Sinhala-speaking driver and mark anything that reads wrong. Corrections go into
`si.json` and out to the phones with an `eas update` (no new build). `{time}`, `{n}`, `{name}`,
`{stop}` and the like are filled in by the app and must stay as they are. Numbers, plates and
times stay in Latin digits in both languages. Android's own menu names in the Phone setup steps
stay in English, as the phones show them.

83 new keys.

| key | English | Sinhala (now) | new or changed |
|---|---|---|---|
| `tabs.fuel` | Fuel | ඉන්ධන | new |
| `task.allStops` | All stops in Google Maps | සියලු නැවතුම් Google Maps හි | new |
| `task.googleNotOnMap` | A Google place: Navigate shows it in Google Maps | Google ස්ථානයකි: මග පෙන්වන්න එය Google Maps හි පෙන්වයි | new |
| `task.allStopsLeftTitle` | Google Maps takes 10 stops at a time | Google Maps එක වරකට නැවතුම් 10 ක් ගනී | new |
| `task.allStopsLeftBody` | The first 10 stops are in; {n} more come after them. Open All stops again when you reach stop 10. | පළමු නැවතුම් 10 ඇතුළත් ය; ඉන් පසු තවත් {n} ක් ඇත. 10 වැනි නැවතුමට ළඟා වූ විට සියලු නැවතුම් නැවත විවෘත කරන්න. | new |
| `me.wifiOnly` | Upload videos on Wi-Fi only | වීඩියෝ Wi-Fi හරහා පමණක් උඩුගත කරන්න | new |
| `shift.title` | At work? | වැඩට ආවද? | new |
| `shift.body` | Switch On duty when you start. | වැඩ පටන් ගත් විට රාජකාරියේ ඔන් කරන්න. | new |
| `fuel.title` | Fuel | ඉන්ධන | new |
| `fuel.thisMonth` | This month | මේ මාසය | new |
| `fuel.entries` | Fills | පිරවීම් | new |
| `fuel.litres` | litres | ලීටර් | new |
| `fuel.logFuel` | Log fuel | ඉන්ධන සටහන | new |
| `fuel.nothingYet` | No fuel logged this month. | මේ මාසයේ ඉන්ධන සටහන් නැත. | new |
| `fuel.record` | Record video | වීඩියෝව පටිගත කරන්න | new |
| `fuel.retake` | Retake | නැවත පටිගත කරන්න | new |
| `fuel.required` | A video of the fill is needed. | ඉන්ධන පිරවීමේ වීඩියෝවක් අවශ්‍යයි. | new |
| `fuel.recorded` | Recorded · {duration} · {size} | පටිගත කළා · {duration} · {size} | new |
| `fuel.uploading` | Uploading {pct} % · continues when there is signal | උඩුගත වෙමින් {pct} % · සංඥාව ලැබුණු විට ඉදිරියට යයි | new |
| `fuel.waitingWifi` | Waiting for Wi-Fi | Wi-Fi සඳහා රැඳී සිටී | new |
| `fuel.uploaded` | Uploaded | උඩුගත කළා | new |
| `fuel.failed` | Failed · tap to retry | අසාර්ථකයි · නැවත උත්සාහ කිරීමට තට්ටු කරන්න | new |
| `fuel.noVideo` | No video | වීඩියෝවක් නැත | new |
| `fuel.savedOffline` | Saved · sends when there is signal | සුරැකුණා · සංඥාව ලැබුණු විට යවයි | new |
| `fuel.recordTitle` | Record the fill | පිරවීම පටිගත කරන්න | new |
| `fuel.recordHint` | Show each step in turn and tick it. No sound is recorded. | එක් එක් පියවර පිළිවෙළින් පෙන්වා හරි ලකුණ තබන්න. ශබ්දය පටිගත නොවේ. | new |
| `fuel.start` | Start | පටන් ගන්න | new |
| `fuel.stop` | Stop | නවත්වන්න | new |
| `fuel.maxLength` | At least 30 s · up to 12 minutes | අවම තත්පර 30 · උපරිම විනාඩි 12 | new |
| `fuel.cameraDenied` | Fame Driver is not allowed to use the camera. | Fame Driver ට කැමරාව භාවිතා කිරීමට අවසර නැත. | new |
| `fuel.recordFailed` | Recording did not work. Try again. | පටිගත කිරීම සාර්ථක වුණේ නැත. නැවත උත්සාහ කරන්න. | new |
| `fuel.tooShort` | Record at least 30 seconds. | අවම වශයෙන් තත්පර 30 ක් පටිගත කරන්න. | new |
| `fuel.checklist.plate` | Number plate | අංක තහඩුව | new |
| `fuel.checklist.zero` | Pump display at zero before pumping | පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ | new |
| `fuel.checklist.pumping` | Pumping | පොම්ප කරමින් | new |
| `fuel.checklist.final` | Final pump display: litres and amount | අවසාන පොම්ප තිරය: ලීටර් සහ මුදල | new |
| `fuel.step` | Step {n} of {total} | පියවර {n} / {total} | new |
| `fuel.tickStep` | Done · next step | හරි · ඊළඟ පියවර | new |
| `fuel.allSteps` | All steps done. Tap Stop when the pump has stopped. | සියලු පියවර අවසන්. පොම්පය නැවතුණු විට නවත්වන්න තට්ටු කරන්න. | new |
| `fuel.stopAfterSteps` | Stop opens after the last step | අවසාන පියවරෙන් පසු නවත්වන්න විවෘත වේ | new |
| `fuel.minLength` | At least 30 s | අවම තත්පර 30 | new |
| `fuel.stepsLeft` | {n} steps still to show | තව පියවර {n} ක් පෙන්විය යුතුයි | new |
| `fuel.notComplete` | The video is not complete: {reason} | වීඩියෝව සම්පූර්ණ නැත: {reason} | new |
| `fuel.discardPieces` | Discard | ඉවත දමන්න | new |
| `fuel.use` | Use this video | මේ වීඩියෝව භාවිතා කරන්න | new |
| `fuel.countdown` | {seconds} s left · the recording stops at 12 minutes | තත්පර {seconds} ක් ඉතිරියි · විනාඩි 12 දී පටිගත කිරීම නවතියි | new |
| `fuel.interrupted` | Recording was interrupted. What you recorded is kept. | පටිගත කිරීමට බාධා විය. පටිගත කළ කොටස තබාගෙන ඇත. | new |
| `fuel.continueRecording` | Continue recording | දිගටම පටිගත කරන්න | new |
| `fuel.useVideo` | Use this video | මේ වීඩියෝව භාවිතා කරන්න | new |
| `fuel.segments` | {n} pieces | කොටස් {n} | new |
| `fuel.segmentsLeft` | {n} more allowed | තව කොටස් {n} ක් එක් කළ හැක | new |
| `fuel.noMoreSegments` | No more pieces can be added: use what you have. | තවත් කොටස් එක් කළ නොහැක: තිබෙන දේ භාවිතා කරන්න. | new |
| `fuel.uploadingSize` | Uploading {size} · {pct} % | උඩුගත වෙමින් {size} · {pct} % | new |
| `fuel.interruptedShort` | interrupted | බාධා විය | new |
| `phoneSetup.title` | Phone setup | දුරකථන සැකසුම | new |
| `phoneSetup.yourBrand` | Your {brand} phone | ඔබගේ {brand} දුරකථනය | new |
| `phoneSetup.yourPhone` | Your phone | ඔබගේ දුරකථනය | new |
| `phoneSetup.stoppedOnce` | {phone} stopped Fame Driver for {minutes} min ({when}). No trip is recorded while it is stopped. | {phone} Fame Driver විනාඩි {minutes} ක් නවත්වා තැබුවා ({when}). එය නවතා ඇති විට ගමන සටහන් නොවේ. | new |
| `phoneSetup.stoppedMany` | {phone} stopped Fame Driver {count} times since {when}, {minutes} min in all. No trip is recorded while it is stopped. | {phone} {when} සිට Fame Driver {count} වතාවක් නවත්වා තැබුවා, මුළු විනාඩි {minutes}. එය නවතා ඇති විට ගමන සටහන් නොවේ. | new |
| `phoneSetup.doOnce` | Change these settings once: | මේ සැකසුම් එක් වරක් වෙනස් කරන්න: | new |
| `phoneSetup.open` | Open {brand} settings | {brand} සැකසුම් විවෘත කරන්න | new |
| `phoneSetup.openApp` | Open app settings | යෙදුමේ සැකසුම් විවෘත කරන්න | new |
| `phoneSetup.done` | Done | කළා | new |
| `phoneSetup.steps.oppo 1` | Settings → Apps → Fame Driver → Battery usage: turn on "Allow background activity" and "Allow auto launch". | Settings → Apps → Fame Driver → Battery usage: "Allow background activity" සහ "Allow auto launch" ක්‍රියාත්මක කරන්න. | new |
| `phoneSetup.steps.oppo 2` | Settings → Battery → More settings → Optimise battery use: Fame Driver → "Don't optimise". | Settings → Battery → More settings → Optimise battery use: Fame Driver → "Don't optimise" තෝරන්න. | new |
| `phoneSetup.steps.oppo 3` | Recent apps: pull Fame Driver down (or tap the lock) so it stays locked. | Recent apps තුළ Fame Driver පහළට අදින්න (හෝ අගුල තට්ටු කරන්න), එවිට එය අගුළු වී තිබේ. | new |
| `phoneSetup.steps.realme 1` | Settings → Apps → Fame Driver → Battery usage: turn on "Allow background activity" and "Allow auto launch". | Settings → Apps → Fame Driver → Battery usage: "Allow background activity" සහ "Allow auto launch" ක්‍රියාත්මක කරන්න. | new |
| `phoneSetup.steps.realme 2` | Settings → Battery → App battery management: Fame Driver → allow running in the background. | Settings → Battery → App battery management: Fame Driver පසුබිමේ ක්‍රියාත්මක වීමට ඉඩ දෙන්න. | new |
| `phoneSetup.steps.realme 3` | Recent apps: pull Fame Driver down (or tap the lock) so it stays locked. | Recent apps තුළ Fame Driver පහළට අදින්න (හෝ අගුල තට්ටු කරන්න), එවිට එය අගුළු වී තිබේ. | new |
| `phoneSetup.steps.xiaomi 1` | Settings → Apps → Fame Driver: turn on "Autostart". | Settings → Apps → Fame Driver: "Autostart" ක්‍රියාත්මක කරන්න. | new |
| `phoneSetup.steps.xiaomi 2` | Same page → Battery saver: "No restrictions". | එම පිටුවේම → Battery saver: "No restrictions" තෝරන්න. | new |
| `phoneSetup.steps.xiaomi 3` | Recent apps: hold Fame Driver and tap the lock. | Recent apps තුළ Fame Driver ඔබාගෙන සිට අගුල තට්ටු කරන්න. | new |
| `phoneSetup.steps.vivo 1` | Settings → Battery → Background power consumption management: Fame Driver → "Allow". | Settings → Battery → Background power consumption management: Fame Driver → "Allow" තෝරන්න. | new |
| `phoneSetup.steps.vivo 2` | i Manager → App manager → Autostart: turn on Fame Driver. | i Manager → App manager → Autostart: Fame Driver ක්‍රියාත්මක කරන්න. | new |
| `phoneSetup.steps.vivo 3` | Recent apps: pull Fame Driver down so it stays locked. | Recent apps තුළ Fame Driver පහළට අදින්න, එවිට එය අගුළු වී තිබේ. | new |
| `phoneSetup.steps.samsung 1` | Settings → Apps → Fame Driver → Battery: "Unrestricted". | Settings → Apps → Fame Driver → Battery: "Unrestricted" තෝරන්න. | new |
| `phoneSetup.steps.samsung 2` | Settings → Battery → Background usage limits: Fame Driver must not be in "Sleeping apps" or "Deep sleeping apps"; add it to "Never sleeping apps". | Settings → Battery → Background usage limits: Fame Driver "Sleeping apps" හෝ "Deep sleeping apps" තුළ නොතිබිය යුතුයි; එය "Never sleeping apps" වලට එක් කරන්න. | new |
| `phoneSetup.steps.samsung 3` | Recent apps: tap the Fame Driver icon → "Keep open". | Recent apps තුළ Fame Driver අයිකනය තට්ටු කර → "Keep open" තෝරන්න. | new |
| `phoneSetup.steps.other 1` | Settings → Apps → Fame Driver → Battery: allow background activity, no restrictions. | Settings → Apps → Fame Driver → Battery: පසුබිම් ක්‍රියාකාරිත්වයට ඉඩ දෙන්න, සීමා නැතිව. | new |
| `phoneSetup.steps.other 2` | If the phone has "Autostart" or "Auto launch", turn it on for Fame Driver. | දුරකථනයේ "Autostart" හෝ "Auto launch" ඇත්නම්, Fame Driver සඳහා එය ක්‍රියාත්මක කරන්න. | new |
| `phoneSetup.steps.other 3` | Recent apps: lock Fame Driver so it stays open. | Recent apps තුළ Fame Driver අගුළු දමන්න, එවිට එය විවෘතව පවතී. | new |
| `arrival.title` | Arrived at {stop}? | {stop} වෙත ළඟා වුණාද? | new |
| `arrival.body` | Tap to mark Arrived | ළඟා විය ලෙස සටහන් කිරීමට තට්ටු කරන්න | new |
