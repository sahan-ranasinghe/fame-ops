# Phase 5: the driver app's new and changed strings, for the Sinhala check

14 October 2026. Every key the Phase 5 work added or changed in `apps/driver/src/i18n/en.json`,
with the Sinhala now in `si.json` (written by Claude Code during the work; nothing is left in
English). Please read the Sinhala column with the boss or a Sinhala-speaking driver and mark
anything that reads wrong. Corrections go into `si.json` and out to the phones with an `eas update`
(no new build). `{time}`, `{n}`, `{name}` and the like are filled in by the app and must stay as they are.
Numbers, plates and times stay in Latin digits in both languages.

36 new keys, 19 changed keys.

| key | English | Sinhala (now) | new or changed |
|---|---|---|---|
| `today.leaveBy` | Leave by {time} | {time} ට පිටත් වන්න | new |
| `today.moreStops` | +{n} more | තවත් {n} | new |
| `today.notAccepted` | Not accepted yet | තවම පිළිගෙන නැත | new |
| `today.accepted` | Accepted | පිළිගත්තා | new |
| `task.leaveBy` | Leave by {time} | {time} ට පිටත් වන්න | new |
| `task.arriveBy` | Arrive by {time} | {time} ට පෙර ළඟා වන්න | new |
| `task.arrived` | Arrived | ළඟා විය | new |
| `task.skip` | Skip | මඟ හරින්න | new |
| `task.skipTitle` | Skip this stop? | මෙම නැවතුම මඟ හරිනවාද? | new |
| `task.skipWhy` | Why? | ඇයි? | new |
| `task.skipReason.closed` | Closed | වසා ඇත | new |
| `task.skipReason.nobodyThere` | Nobody there | කිසිවෙක් නැත | new |
| `task.skipReason.notNeeded` | Not needed | අවශ්‍ය නැත | new |
| `task.skipReason.other` | Other | වෙනත් | new |
| `task.skipNote` | A word for the office (optional) | කාර්යාලයට වචනයක් (අත්‍යවශ්‍ය නොවේ) | new |
| `task.skipConfirm` | Skip stop | නැවතුම මඟ හරින්න | new |
| `task.skipped` | Skipped | මඟ හැරිණි | new |
| `task.currentStop` | Now | දැන් | new |
| `task.stopsLeftTitle` | {n} stops are not done | නැවතුම් {n} ක් අවසන් කර නැත | new |
| `task.stopsLeftBody` | Finish the task anyway? They will be marked as not visited. | කෙසේ වෙතත් කාර්යය අවසන් කරනවාද? ඒවා නොගිය ලෙස සලකුණු වේ. | new |
| `task.finishAnyway` | Finish anyway | කෙසේ වෙතත් අවසන් කරන්න | new |
| `task.minutesThere` | {n} min there | එහි විනාඩි {n} | new |
| `task.accept` | Accept | පිළිගන්න | new |
| `task.accepted` | Accepted ✓ {time} | පිළිගත්තා ✓ {time} | new |
| `task.cantDo` | Can't do this task | මෙම කාර්යය කළ නොහැක | new |
| `task.declineTitle` | Can't do this task? | මෙම කාර්යය කළ නොහැකිද? | new |
| `task.declineReason.vehicleProblem` | Vehicle problem | වාහනයේ ගැටලුවක් | new |
| `task.declineReason.notAvailable` | Not available | ලබා ගත නොහැක | new |
| `task.declineReason.unwell` | Unwell | අසනීපයි | new |
| `task.declineReason.other` | Other | වෙනත් | new |
| `task.declineNote` | A word for the office (optional) | කාර්යාලයට වචනයක් (අත්‍යවශ්‍ය නොවේ) | new |
| `task.declineConfirm` | Can't do it | කළ නොහැක | new |
| `task.declined` | Declined | ප්‍රතික්ෂේප කළා | new |
| `task.alreadyReassigned` | This task was already given to another driver. | මෙම කාර්යය දැනටමත් වෙනත් රියදුරෙකුට දී ඇත. | new |
| `task.alreadyStarted` | This task was already started. | මෙම කාර්යය දැනටමත් ආරම්භ කර ඇත. | new |
| `task.declinedBody` | The office will give this task to another driver. | කාර්යාලය මෙම කාර්යය වෙනත් රියදුරෙකුට දෙනු ඇත. | new |
| `permissions.locationWhy` | Fame Driver needs Location all the time to record trips and mileage. | ගමන් සහ කිලෝමීටර් සටහන් කිරීමට Fame Driver හට සෑම විටම ස්ථානය අවශ්‍යයි. | changed |
| `permissions.batteryWhy` | So the phone does not stop recording to save battery. | බැටරිය ඉතිරි කිරීම සඳහා දුරකථනය සටහන් කිරීම නතර නොකිරීමට. | changed |
| `permissions.backgroundWhy` | Some phones stop apps that work in the background. Without this, recording stops when the screen is off. | සමහර දුරකථන පසුබිමේ වැඩ කරන යෙදුම් නවත්වයි. මෙය නොමැතිව තිරය වසා ඇති විට සටහන් කිරීම නතර වේ. | changed |
| `today.sharing` | On duty | රාජකාරියේ | changed |
| `today.sharingOn` | Trips and mileage are recorded while on duty · works in background | රාජකාරියේ සිටින විට ගමන් සහ කිලෝමීටර් සටහන් වේ · පසුබිමේද ක්‍රියා කරයි | changed |
| `today.sharingOff` | Off duty · trips are not recorded | රාජකාරියෙන් බැහැර · ගමන් සටහන් නොවේ | changed |
| `today.needLocation` | Allow location first, then go on duty. | පළමුව ස්ථානයට ඉඩ දී, පසුව රාජකාරියට යන්න. | changed |
| `task.sharingLocation` | On duty | රාජකාරියේ | changed |
| `task.notSharing` | Off duty | රාජකාරියෙන් බැහැර | changed |
| `tracking.locationOff` | Location is switched off on this phone. Trips are not recorded. | මෙම දුරකථනයේ ස්ථානය (Location) වසා ඇත. ගමන් සටහන් නොවේ. | changed |
| `tracking.battery` | Battery saving may stop recording when the screen is off. | බැටරි ඉතිරිකිරීම නිසා තිරය වසා ඇති විට සටහන් කිරීම නතර විය හැක. | changed |
| `tracking.restarted` | Recording had stopped. It is running again. | සටහන් කිරීම නතර වී තිබුණි. දැන් නැවත ක්‍රියාත්මකයි. | changed |
| `tracking.taskNotSharing` | A task is in progress but you are off duty. | කාර්යයක් සිදුවෙමින් පවතී, නමුත් ඔබ රාජකාරියෙන් බැහැරයි. | changed |
| `tracking.shareNow` | Go on duty | රාජකාරියට යන්න | changed |
| `tracking.stoppedTitle` | Fame Driver · recording stopped | Fame Driver · සටහන් කිරීම නතර විය | changed |
| `tracking.stoppedBody` | Tap to go on duty again. | නැවත රාජකාරියට යාමට තට්ටු කරන්න. | changed |
| `service.title` | Fame Driver · On duty | Fame Driver · රාජකාරියේ | changed |
| `service.body` | Recording trips | ගමන් සටහන් වෙමින් | changed |
| `gate.sharingBody` | Turn on Location to go on duty. | රාජකාරියට යාමට ස්ථානය සක්‍රිය කරන්න. | changed |

Where the keys are used: `today.*` the Today tab (the next task card with Leave by, the first two stops
and "+N more", Accept / Accepted, "Can't do this task", Later today's Accepted / Not accepted yet);
`task.*` the task screen (the stops with Arrive by and the minutes there, Arrived / Done / Skip and the
skip reasons, the decline reasons and the confirm texts, "already reassigned"); `gate.*`,
`permissions.*`, `service.*`, `tracking.*` the On duty wording and the location cover. The push
notification texts (new, changed, cancelled, reassigned task; leave in 30 minutes, time to leave; please
accept) are not in these files: the server sends them in the driver's language from `push-task`, and
their Sinhala is in `supabase/functions/push-task/index.ts`.
