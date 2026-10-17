// Phone setup (15 October 2026; off Today since Phase 7 item 7). Some phones'
// battery managers freeze Fame Driver while it records: test.driver2 on 15
// October lost 7, 3 and 5 minutes with 2–7 m GPS before and after. While on duty
// the heartbeat comes every minute; over 3 minutes between two heartbeats of the
// same duty period means the phone stopped the app. The gaps of the last 7 days
// are kept on the phone. The brand's steps (an intent per known battery or
// startup page, App info when none opens, and the steps for OPPO, realme, Xiaomi,
// vivo, Samsung or any other phone) show once in the first-run Permissions flow,
// after the battery step, and on Me → Phone setup, which says at the top when
// the phone stopped the app on one of the last 3 days (until Done there). Pure:
// no storage and no React Native, so scripts/test-phone-setup.ts runs it.

/** Over this long between two heartbeats of one duty period: the phone stopped the app. */
export const GAP_MIN_MS = 3 * 60_000;
/** The gaps are kept this long … */
export const KEEP_GAPS_MS = 7 * 86_400_000;
/** … and Me → Phone setup tells about the last 3 days. */
export const RECENT_MS = 3 * 86_400_000;
const MAX_GAPS = 60;

export interface Beat {
  at: number;
  sessionId: string | null;
}

export interface Gap {
  from: number;
  to: number;
}

/** A heartbeat now: the gap since the one before, when both belong to the same duty period and over 3 minutes passed. */
export function noteBeat(prev: Beat | null, now: Beat): Gap | null {
  if (!prev || !now.sessionId || prev.sessionId !== now.sessionId) return null;
  return now.at - prev.at > GAP_MIN_MS ? { from: prev.at, to: now.at } : null;
}

/** The gaps worth keeping: the last 7 days, oldest first, at most 60. */
export function keepGaps(gaps: Gap[], now: number): Gap[] {
  return gaps.filter((g) => now - g.to <= KEEP_GAPS_MS).sort((a, b) => a.from - b.from).slice(-MAX_GAPS);
}

/** The gaps Me → Phone setup tells about: the last 3 days, after the driver last tapped Done. Newest first. */
export function gapsToShow(gaps: Gap[], dismissedAt: number | null, now: number): Gap[] {
  return gaps.filter((g) => now - g.to <= RECENT_MS && (dismissedAt === null || g.to > dismissedAt)).sort((a, b) => b.from - a.from);
}

export const gapMinutes = (g: Gap) => Math.max(1, Math.round((g.to - g.from) / 60_000));

/** The sentence at the top of Me → Phone setup: its key and values (the screen formats `at`). */
export type StoppedNote =
  | { key: 'phoneSetup.stoppedOnce'; minutes: number; at: number }
  | { key: 'phoneSetup.stoppedMany'; count: number; minutes: number; at: number };

/** Once: how long and when. More often: how many times, the minutes in all, since the oldest. Nothing to tell: null. */
export function stoppedNote(gaps: Gap[], dismissedAt: number | null, now: number): StoppedNote | null {
  const shown = gapsToShow(gaps, dismissedAt, now);
  if (shown.length === 0) return null;
  if (shown.length === 1) return { key: 'phoneSetup.stoppedOnce', minutes: gapMinutes(shown[0]), at: shown[0].from };
  const minutes = shown.reduce((sum, g) => sum + gapMinutes(g), 0);
  return { key: 'phoneSetup.stoppedMany', count: shown.length, minutes, at: shown[shown.length - 1].from };
}

export type SetupBrand = 'oppo' | 'realme' | 'xiaomi' | 'vivo' | 'samsung' | 'other';

/** The brand whose steps apply. realme before OPPO (both run Oplus software); OnePlus runs ColorOS too. */
export function setupBrand(brand: string | null | undefined, manufacturer: string | null | undefined): SetupBrand {
  const name = `${brand ?? ''} ${manufacturer ?? ''}`.toLowerCase();
  if (/realme/.test(name)) return 'realme';
  if (/oppo|oneplus/.test(name)) return 'oppo';
  if (/xiaomi|redmi|poco/.test(name)) return 'xiaomi';
  if (/vivo|iqoo/.test(name)) return 'vivo';
  if (/samsung/.test(name)) return 'samsung';
  return 'other';
}

const NAMES: Record<string, string> = {
  oppo: 'OPPO', realme: 'realme', oneplus: 'OnePlus', xiaomi: 'Xiaomi', redmi: 'Redmi', poco: 'POCO', vivo: 'vivo', iqoo: 'iQOO', samsung: 'Samsung',
};

/** The steps: a list per brand under this key in en.json and si.json. */
export const stepsKey = (brand: SetupBrand) => `phoneSetup.steps.${brand}`;

/** The button: "Open OPPO settings" for a brand with its own pages, else "Open app settings" (App info). */
export function openSettingsLabel(brand: SetupBrand, name: string | null): { key: 'phoneSetup.open'; brand: string } | { key: 'phoneSetup.openApp' } {
  return name && brand !== 'other' ? { key: 'phoneSetup.open', brand: name } : { key: 'phoneSetup.openApp' };
}

/** The brand as the phone shows it ("OPPO", "Redmi"), or null when the phone does not say. */
export function brandName(brand: string | null | undefined, manufacturer: string | null | undefined): string | null {
  const raw = (brand || manufacturer || '').trim();
  if (!raw) return null;
  return NAMES[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

export interface SettingsIntent {
  packageName: string;
  className: string;
  extra?: Record<string, string>;
}

/**
 * The brand's battery or startup settings pages, tried in order (the names differ between versions of each
 * maker's software; a page that is not on the phone fails to open and the next is tried). After them the
 * caller opens the app's own App info page, where most of the steps start.
 */
export function settingsIntents(brand: SetupBrand, appId: string, appLabel: string): SettingsIntent[] {
  switch (brand) {
    case 'oppo':
    case 'realme':
      return [
        { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' },
        { packageName: 'com.coloros.safecenter', className: 'com.coloros.safecenter.startupapp.StartupAppListActivity' },
        { packageName: 'com.oplus.safecenter', className: 'com.oplus.safecenter.startupapp.StartupAppListActivity' },
        { packageName: 'com.oppo.safe', className: 'com.oppo.safe.permission.startup.StartupAppListActivity' },
        { packageName: 'com.coloros.oppoguardelf', className: 'com.coloros.powermanager.fuelgaue.PowerUsageModelActivity' },
      ];
    case 'xiaomi':
      return [
        { packageName: 'com.miui.powerkeeper', className: 'com.miui.powerkeeper.ui.HiddenAppsConfigActivity', extra: { package_name: appId, package_label: appLabel } },
        { packageName: 'com.miui.securitycenter', className: 'com.miui.permcenter.autostart.AutoStartManagementActivity' },
      ];
    case 'vivo':
      return [
        { packageName: 'com.vivo.permissionmanager', className: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' },
        { packageName: 'com.iqoo.secure', className: 'com.iqoo.secure.ui.phoneoptimize.BgStartUpManager' },
        { packageName: 'com.iqoo.secure', className: 'com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity' },
      ];
    case 'samsung':
      return [
        { packageName: 'com.samsung.android.lool', className: 'com.samsung.android.sm.battery.ui.BatteryActivity' },
        { packageName: 'com.samsung.android.lool', className: 'com.samsung.android.sm.ui.battery.BatteryActivity' },
        { packageName: 'com.samsung.android.sm', className: 'com.samsung.android.sm.ui.battery.BatteryActivity' },
      ];
    default:
      return [];
  }
}
