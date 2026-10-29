// Hotfix O2-H2: the office as the component tests see it. `mockOfficeApi` answers each tool from the real fixtures
// (src/office/__fixtures__, made by scripts/make-office-fixtures.py against the local office-api) and records every call;
// `mockUseApp` is the driver app's provider as Office mode reads it (English words, the default settings).
/* eslint-disable @typescript-eslint/no-require-imports */
import type { ReactNode } from 'react';

export const FIX = (name: string) => require(`../src/office/__fixtures__/${name}.json`);

declare const __dirname: string;
const here = __dirname;

export interface Recorded { tool: string; args: Record<string, unknown> }
export const calls: Recorded[] = [];
/** Answers per tool; a test may replace one (a refusal, a slow answer). */
export const answers: Record<string, (args: Record<string, unknown>) => unknown> = {};

const DEFAULTS: Record<string, (args: Record<string, unknown>) => unknown> = {
  my_inbox: () => ({ unread: 0, items: [] }),
  get_settings: () => ({ settings: { tasks_need_approval: false, self_drive_allowed: true } }),
  plan_task: () => FIX('create_task'),
  availability: () => ({ drivers: [], vehicles: { drivers_free: [] }, counts: { free: 0 } }),
  suggest_vehicles: () => ({ vehicles: [], drivers: [], drivers_free: [] }),
  create_task: () => FIX('create_task'),
  create_request: () => FIX('create_request'),
  book_vehicle: () => FIX('book_vehicle'),
  update_request: () => FIX('update_request'),
  decide_request: () => FIX('decide_request_approve'),
  redecide_request: () => FIX('redecide_request_keep'),
  update_task: () => FIX('update_task'),
  reassign_task: () => FIX('reassign_task'),
  cancel_task: () => FIX('cancel_task'),
  ask_drivers: () => FIX('ask_drivers'),
  task_detail: () => FIX('task_detail'),
  list_requests: () => FIX('list_requests_one'),
};

export const mockOfficeApi = {
  me: async () => FIX('me'),
  call: async (tool: string, args: Record<string, unknown> = {}) => {
    calls.push({ tool, args });
    const fn = answers[tool] ?? DEFAULTS[tool];
    if (!fn) return {};
    return fn(args);
  },
};

export function resetFake() {
  calls.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
}

/**
 * Round 4–7: the English strings still waiting in a sidecar (src/i18n/parts/*.json, { en, si } from the root) for the
 * lead's merge into en.json; a key in neither still fails the test (the app's strict translate).
 */
function sidecarEnglish(): Record<string, unknown> {
  const fs = require('fs') as { existsSync: (p: string) => boolean; readdirSync: (p: string) => string[]; readFileSync: (p: string, enc: 'utf8') => string };
  const path = require('path') as { join: (...parts: string[]) => string };
  const dir = path.join(here, '..', 'src', 'i18n', 'parts');
  const out: Record<string, unknown> = {};
  const merge = (into: Record<string, unknown>, from: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(from)) {
      if (v && typeof v === 'object' && into[k] && typeof into[k] === 'object') merge(into[k] as Record<string, unknown>, v as Record<string, unknown>);
      else into[k] = v;
    }
  };
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x: string) => x.endsWith('.json')).sort()) merge(out, (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { en?: Record<string, unknown> }).en ?? {});
  }
  return out;
}

export function mockUseApp() {
  const { translate, translateList, hasText } = require('../src/i18n');
  const { DEFAULT_DRIVER_SETTINGS } = require('../src/lib/api');
  const waiting = sidecarEnglish();
  const fromSidecar = (k: string): unknown => k.split('.').reduce<unknown>((o, x) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[x] : undefined), waiting);
  const t = (k: string, v?: Record<string, string | number>): string => {
    const side = fromSidecar(k);
    if (typeof side === 'string' && !hasText('en', k)) return side.replace(/\{(\w+)\}/g, (_m, n: string) => String(v?.[n] ?? `{${n}}`));
    return translate('en', k, v);
  };
  return {
    t,
    tList: (k: string) => translateList('en', k),
    language: 'en',
    setLanguage: jest.fn(),
    settings: DEFAULT_DRIVER_SETTINGS,
    dataAvailable: true,
    // Round 50: no driver state behind Office mode (Driving mode's tests give their own).
    me: null,
    tasks: [],
    officeDriver: false,
    driving: false,
    enterDriving: async () => 'ok',
    officeSignOutCheck: async () => 'ok',
    loadDriveTrips: async () => null,
  };
}

/** Every console.error during a test fails it (React prints its render errors there). */
export function failOnConsoleError() {
  const seen: unknown[][] = [];
  // React's act() notices are the test harness talking (store updates outside act), never the app's errors.
  const spy = jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { if (!/act\(/.test(String(a[0]))) seen.push(a); });
  return { seen, restore: () => spy.mockRestore() };
}

export const Passthrough = ({ children }: { children: ReactNode }) => children;
