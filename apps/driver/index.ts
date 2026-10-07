// The app's entry file.
//
// The background location task has to be defined before Android delivers a
// position, also when the phone starts the app in the background with no screen
// open. So it is loaded here, ahead of the screens.
import './src/lib/locationTask';

import 'expo-router/entry';
