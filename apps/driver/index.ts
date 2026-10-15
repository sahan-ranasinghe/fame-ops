// The app's entry file.
//
// The background location task has to be defined before Android delivers a
// position, also when the phone starts the app in the background with no screen
// open. So it is loaded here, ahead of the screens.
import './src/lib/locationTask';
import './src/lib/backgroundTask';
// Phase 7: a clock-out by the server (the cut-off, the office) stops location even with no screen open.
import './src/lib/duty';

import 'expo-router/entry';
