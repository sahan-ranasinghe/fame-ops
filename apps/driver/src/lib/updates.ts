// Code updates over the air (EAS Update), for builds that include them (the
// preview build). Android checks for an update each time the app starts and
// opens it straight away when it arrives within a few seconds; otherwise it is
// used from the next start. This file adds the manual check on the Me tab.
//
// expo-updates is loaded only when asked for: a build made before it was added
// simply has no updates, instead of failing to start.

type UpdatesModule = typeof import('expo-updates');

let loaded: UpdatesModule | null | undefined;

function updates(): UpdatesModule | null {
  if (loaded === undefined) {
    try {
      loaded = require('expo-updates') as UpdatesModule;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

/** When the code now running was published, or null when this build has no updates (development build). */
export function runningUpdate(): { publishedAt: Date | null; channel: string | null } | null {
  const module = updates();
  if (!module?.isEnabled) return null;
  return { publishedAt: module.createdAt, channel: module.channel };
}

export type UpdateCheck = 'not-available' | 'up-to-date' | 'failed';

/** Looks for a newer update. If there is one, it is downloaded and the app restarts into it (this call then never returns). */
export async function checkAndApplyUpdate(): Promise<UpdateCheck> {
  const module = updates();
  if (!module?.isEnabled) return 'not-available';
  try {
    const check = await module.checkForUpdateAsync();
    if (!check.isAvailable) return 'up-to-date';
    await module.fetchUpdateAsync();
    await module.reloadAsync();
    return 'up-to-date';
  } catch {
    return 'failed';
  }
}
