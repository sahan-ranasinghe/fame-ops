// The app config is app.json plus the parts that depend on the machine the
// build runs on. At the moment that is only the Firebase file for push
// notifications (google-services.json):
//
//   - on an EAS build worker it comes from the file environment variable
//     GOOGLE_SERVICES_JSON (eas env:set ... --type file), whose value is the
//     path of the file on the worker;
//   - on the laptop (expo prebuild, expo run) the local copy next to this
//     file is used. It is not committed (.gitignore).
//
// A build without the file still builds; push notifications then do not work.
//
// The task map's Google key (Phase 6, Part 5): GOOGLE_ANDROID_MAPS_KEY, an EAS
// environment variable (secret, never in git), restricted in the Google Cloud
// console to the package com.fameglobal.driver and the signing key's SHA-1. With
// it the build carries the key (android.config.googleMaps: the manifest's
// com.google.android.geo.API_KEY) and the task map is Google's; without it the
// map stays OpenFreeMap (MapLibre). A build with the key gets its own runtime
// version (1.2.0-gmaps), so an update made with the key never reaches a phone
// built without it (the Google map would crash there for want of the key).

import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export default ({ config }: ConfigContext): ExpoConfig => {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON?.trim();
  const local = join(__dirname, 'google-services.json');
  const googleServicesFile = fromEnv && fromEnv !== '' ? fromEnv : existsSync(local) ? './google-services.json' : undefined;
  const mapsKey = process.env.GOOGLE_ANDROID_MAPS_KEY?.trim() || undefined;
  return {
    ...config,
    name: config.name ?? 'Fame Driver',
    slug: config.slug ?? 'fame-driver',
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
      // Expo's own setting (manifest meta-data com.google.android.geo.API_KEY); unlike a plugin's
      // options it is left out of the public config, so it is not in the update manifests.
      ...(mapsKey ? { config: { ...config.android?.config, googleMaps: { apiKey: mapsKey } } } : {}),
    },
    ...(mapsKey ? { runtimeVersion: `${config.version}-gmaps` } : {}),
    extra: { ...config.extra, googleMapsAndroid: !!mapsKey },
  };
};
