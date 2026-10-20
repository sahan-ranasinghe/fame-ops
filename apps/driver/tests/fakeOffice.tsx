// Hotfix O2-H2: the office as the component tests see it. `mockOfficeApi` answers each tool from the real fixtures
// (src/office/__fixtures__, made by scripts/make-office-fixtures.py against the local office-api) and records every call;
// `mockUseApp` is the driver app's provider as Office mode reads it (English words, the default settings).
/* eslint-disable @typescript-eslint/no-require-imports */
import type { ReactNode } from 'react';

export const FIX = (name: string) => require(`../src/office/__fixtures__/${name}.json`);

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

export function mockUseApp() {
  const { translate, translateList } = require('../src/i18n');
  const { DEFAULT_DRIVER_SETTINGS } = require('../src/lib/api');
  return {
    t: (k: string, v?: Record<string, string | number>) => translate('en', k, v),
    tList: (k: string) => translateList('en', k),
    language: 'en',
    setLanguage: jest.fn(),
    settings: DEFAULT_DRIVER_SETTINGS,
    dataAvailable: true,
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
