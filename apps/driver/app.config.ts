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

import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export default ({ config }: ConfigContext): ExpoConfig => {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON?.trim();
  const local = join(__dirname, 'google-services.json');
  const googleServicesFile = fromEnv && fromEnv !== '' ? fromEnv : existsSync(local) ? './google-services.json' : undefined;
  return {
    ...config,
    name: config.name ?? 'Fame Driver',
    slug: config.slug ?? 'fame-driver',
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
