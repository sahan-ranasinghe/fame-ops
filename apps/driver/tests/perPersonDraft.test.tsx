// Round 4–7, item 10 (docs/phase8-plan.md §33.9): Office mode's trip draft is per person on the phone. The store
// (src/office/trip/draft.ts) with the phone's kv store (tests/setup.ts) and the signed-in person switched by hand: another
// person's draft is never shown, sign-out leaves every draft on the phone, a draft older than the period (30 days, or the
// setting) is dropped when read, a write removes anyone's expired draft, and the old phone-wide draft goes to the person who
// signed in last.

let mockMe: { name: string; email?: string } | null = null;
jest.mock('@/office/store', () => ({ getOfficeMe: () => mockMe, useOfficeMe: () => mockMe, setOfficeMe: () => undefined }));

import Storage from 'expo-sqlite/kv-store';

import { forgetDraftCache, getDraft, newDraft, setDraft, setDraftKeepDays, type TripDraft } from '@/office/trip/draft';

const DAY = 86_400_000;
const as = (email: string | null) => {
  mockMe = email ? { name: email.split('@')[0], email } : null;
};
const draft = (title: string, at = Date.now()): TripDraft => {
  const d = newDraft('task', '2026-10-23');
  return { ...d, fields: { ...d.fields, title }, at };
};
const stored = (email: string) => Storage.getItemSync(`office.trip.draft.${email}`);

beforeEach(() => {
  Storage.clearSync();
  as(null);
  forgetDraftCache();
});

test("another person's draft is never shown; each person gets their own back", () => {
  as('anoja@fame.test');
  setDraft(draft('Anoja to Kandy'));
  expect(getDraft()?.fields.title).toBe('Anoja to Kandy');
  as('kamal@fame.test');
  expect(getDraft()).toBeNull();
  setDraft(draft('Kamal to Galle'));
  as('anoja@fame.test');
  expect(getDraft()?.fields.title).toBe('Anoja to Kandy');
  as('kamal@fame.test');
  expect(getDraft()?.fields.title).toBe('Kamal to Galle');
});

test('sign-out shows nothing and leaves every draft on the phone', () => {
  as('anoja@fame.test');
  setDraft(draft('Anoja to Kandy'));
  as('kamal@fame.test');
  setDraft(draft('Kamal to Galle'));
  as(null);
  forgetDraftCache();
  expect(getDraft()).toBeNull();
  expect(stored('anoja@fame.test')).not.toBeNull();
  expect(stored('kamal@fame.test')).not.toBeNull();
  // Nobody signed in: nothing written to the phone.
  setDraft(draft('nobody'));
  expect(Storage.getItemSync('office.trip.draft')).toBeNull();
});

test('a draft older than 30 days is dropped when read; the setting changes the period', () => {
  as('anoja@fame.test');
  setDraft(draft('old', Date.now() - 31 * DAY));
  forgetDraftCache();
  expect(getDraft()).toBeNull();
  expect(stored('anoja@fame.test')).toBeNull();

  setDraftKeepDays(7);
  setDraft(draft('eight days', Date.now() - 8 * DAY));
  forgetDraftCache();
  expect(getDraft()).toBeNull();
  setDraftKeepDays(90);
  setDraft(draft('forty days', Date.now() - 40 * DAY));
  forgetDraftCache();
  expect(getDraft()?.fields.title).toBe('forty days');
});

test("a write removes anyone's expired draft and leaves another's fresh one", () => {
  as('anoja@fame.test');
  setDraft(draft('Anoja, long ago', Date.now() - 40 * DAY));
  as('sunil@fame.test');
  setDraft(draft('Sunil, yesterday', Date.now() - DAY));
  as('kamal@fame.test');
  setDraft(draft('Kamal, now'));
  expect(stored('anoja@fame.test')).toBeNull();
  expect(stored('sunil@fame.test')).not.toBeNull();
  // Clearing one's own draft leaves the others.
  setDraft(null);
  expect(stored('kamal@fame.test')).toBeNull();
  expect(stored('sunil@fame.test')).not.toBeNull();
});

test('the old phone-wide draft goes to the person who signed in last, and to nobody else', () => {
  Storage.setItemSync('office.email', JSON.stringify('anoja@fame.test'));
  Storage.setItemSync('office.trip.draft', JSON.stringify(draft('from before')));
  as('anoja@fame.test');
  expect(getDraft()?.fields.title).toBe('from before');
  expect(Storage.getItemSync('office.trip.draft')).toBeNull();
  expect(stored('anoja@fame.test')).not.toBeNull();

  Storage.clearSync();
  forgetDraftCache();
  Storage.setItemSync('office.email', JSON.stringify('anoja@fame.test'));
  Storage.setItemSync('office.trip.draft', JSON.stringify(draft('Anoja from before')));
  as('kamal@fame.test');
  expect(getDraft()).toBeNull();
  expect(Storage.getItemSync('office.trip.draft')).toBeNull();
});
