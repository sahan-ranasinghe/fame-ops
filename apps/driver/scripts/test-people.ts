// Office mode (Phase 8, O2, item 7): People and Quick settings under More, the rules of src/office/peopleLogic.ts with
// made-up data, then the screens read as text (each tool behind its button, no role names, every office.people.* key the
// code uses present in both languages (en.json and si.json) with the same placeholders, no Sinhala
// digits). No PIN or link is printed. Pure code, no stack needed:
//   npx tsx scripts/test-people.ts          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  activePill, appendDrivers, appendUsers, cutoffValue, includeInactiveOf, peopleDriverDefs, driverLine, driverLine2, driversArgs, editableFields, emergencyText, emptyDriver, emptyUser, findDriverRow, findUserRow,
  isPin, isTime, latestDriverPhoneChange, licenceOf, licencePhotos, licenceTone, LIMIT, longDate, minutesValue, officePhoneValue, permissionWords, PERSONAL_TRIPS,
  personalTripsValue, phoneDisplay, phoneE164, presetOf, canChangeAccount, givablePermissions, profileFields, profilePatch, QUICK_SETTINGS, randomPin, regularVehicleOf, samePhone, seesPrivate, selfLockout,
  settingInput, switchValue, togglePermission, updateDriverInput, updateUserInput, USERNAME_RULE, userFields, userLine, usersArgs, validateNewDriver, validateNewUser,
  viewLocked, whenText, withSetting, type Words, linkValidWords,
} from '../src/office/peopleLogic';
import type { Driver, DriverProfile, DriversList, FleetSettings, OfficeUser, OfficeUsers } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const t: Words = (key, vars) => (vars ? `${key}(${Object.values(vars).join(',')})` : key);
const NAMES = { days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };

const driver = (over: Partial<Driver> & Pick<Driver, 'name' | 'username'>): Driver => ({ active: true, ...over });
const kamal = driver({ name: 'Kamal Perera', username: 'kamal.p', code: 'D-014', phone: '+94773456789', on_duty_since: '07:02', current_vehicle: 'WP KV-7788', licence: { chip: 'ok', expiry: '2027-03-12' } });
const nimal = driver({ name: 'Nimal Silva', username: 'nimal', code: 'D-020', off_duty_since: '17:52' });
const off = driver({ name: 'Old Driver', username: 'old', code: 'D-001', active: false });

console.log('\n== The lists\' inputs and pages ==');
{
  check(LIMIT === 25, 'a page is 25');
  check(same(driversArgs('', false), { limit: 25 }), 'drivers: the active ones, no search', driversArgs('', false));
  check(same(driversArgs('  kamal ', true), { limit: 25, search: 'kamal', include_inactive: true }), 'drivers: the search trimmed, switched-off included', driversArgs('  kamal ', true));
  const pdefs = peopleDriverDefs((k) => k);
  check(pdefs.length === 1 && pdefs[0].default === 'active' && pdefs[0].kind === 'single' && same(pdefs[0].options.map((o) => o.value), ['active', 'all']) && pdefs[0].options[1].label === 'office.people.filterAll', 'the Filter sheet: Active (the default) or With switched off');
  check(!includeInactiveOf({ show: 'active' }) && includeInactiveOf({ show: 'all' }) && !includeInactiveOf({}) && same(driversArgs('', includeInactiveOf({ show: 'all' })), { limit: 25, include_inactive: true }), 'the choice → include_inactive, exactly as the chip sent it');
  check(same(driversArgs('x', false, 'c2'), { limit: 25, search: 'x', cursor: 'c2' }), 'Load more sends the cursor');
  check(same(usersArgs('   '), { limit: 25 }) && same(usersArgs('sahan', 'c3'), { limit: 25, search: 'sahan', cursor: 'c3' }), 'users: the same way');
  const list: DriversList = { count: 2, total: 3, next: 'c2', drivers: [kamal, nimal] };
  const page: DriversList = { count: 2, total: 3, next: undefined, drivers: [nimal, off] };
  const out = appendDrivers(list, page);
  check(same(out.drivers.map((d) => d.username), ['kamal.p', 'nimal', 'old']) && out.count === 3 && out.total === 3, 'the next page appended, a driver never twice', out.drivers.map((d) => d.username));
  check(!('next' in out), 'the last page clears the cursor');
  const users: OfficeUsers = { count: 1, total: 2, next: 'u2', users: [{ name: 'A', email: 'a@x.lk', role: 'x', active: true, connector_keys: [] }] };
  const u2 = appendUsers(users, { count: 2, total: 2, users: [{ name: 'A', email: 'A@x.lk', role: 'x', active: true, connector_keys: [] }, { name: 'B', email: 'b@x.lk', role: 'x', active: false, connector_keys: [] }] });
  check(same(u2.users.map((u) => u.email), ['a@x.lk', 'b@x.lk']) && !('next' in u2), 'users appended by e-mail, whatever the case', u2.users.map((u) => u.email));
  check(findDriverRow(list, 'nimal')?.name === 'Nimal Silva' && findDriverRow(list, 'nobody') === undefined && findDriverRow(null, 'x') === undefined, 'the driver\'s row by username');
  check(findUserRow(users, 'A@X.LK')?.name === 'A' && findUserRow(users, 'z@x.lk') === undefined, 'the user\'s row by e-mail, whatever the case');
}

console.log('\n== The rows\' lines and pills ==');
{
  check(driverLine(kamal, 'no phone') === 'D-014 · 077 345 6789', 'code · phone as shown', driverLine(kamal, 'no phone'));
  check(driverLine(nimal, 'no phone') === 'D-020 · no phone', 'no phone: the words');
  check(driverLine2(kamal, t) === 'office.people.onDutySince(07:02) · WP KV-7788', 'on duty since · the plate', driverLine2(kamal, t));
  check(driverLine2(nimal, t) === 'office.people.offDutySince(17:52)', 'off duty since');
  check(driverLine2(off, t) === '', 'nothing known: empty');
  check(driverLine2({ ...off, regular_vehicle: 'WP KV-7788' }, t) === 'WP KV-7788 · office.who.regular' && driverLine2({ ...kamal, regular_vehicle: 'WP X-1' }, t) === 'office.people.onDutySince(07:02) · WP KV-7788',
    'Round 3: the regular vehicle when none is held today; the one held wins');
  check(same(activePill(true), { key: 'active', tone: 'green' }) && same(activePill(undefined), { key: 'active', tone: 'green' }) && same(activePill(false), { key: 'off', tone: 'red' }), 'active green, switched off red');
  check(licenceTone('ok') === 'green' && licenceTone('orange') === 'amber' && licenceTone('red') === 'red' && licenceTone('not set') === 'muted' && licenceTone(undefined) === 'muted', 'the licence chip\'s colours');
  check(userLine({ email: 's@fame.lk', phone: '+94771234567', phone_display: '077 123 4567' }) === 's@fame.lk · 077 123 4567', 'e-mail · phone');
  check(userLine({ email: 's@fame.lk', phone: '+94771234567' }) === 's@fame.lk · 077 123 4567', 'the phone shown from +94 when the server sent no display');
  check(userLine({ email: null }) === '', 'nothing: empty');
  check(permissionWords(['assign_tasks', 'view']) === 'view · assign tasks', 'permissions as lower-case words in the table\'s order', permissionWords(['assign_tasks', 'view']));
  check(permissionWords(['users', 'approve']) === 'view · approve · users', 'any permission brings view');
  check(permissionWords(undefined) === '' && permissionWords(['nope']) === '', 'unknown or none: empty');
  check(!/admin|fleet_admin|office|staff|viewer/.test(permissionWords(['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users'])), 'never a role name');
}

console.log('\n== Phones ==');
{
  check(phoneE164('077 123 4567') === '+94771234567' && phoneE164('+94 77 123 4567') === '+94771234567' && phoneE164('0094771234567') === '+94771234567' && phoneE164('771234567') === '+94771234567', 'every way of writing a number → +94…');
  check(phoneE164('') === null && phoneE164('   ') === null && phoneE164(undefined) === null, 'nothing typed: null');
  check(phoneE164('12345') === 'bad' && phoneE164('abc') === 'bad' && phoneE164('+44 20 7946 0958') === 'bad', 'anything else: bad');
  check(samePhone('077 123 4567', '+94771234567') && samePhone('', null) && !samePhone('077 123 4567', '077 123 4568'), 'the same number however written');
  check(phoneDisplay('+94773456789') === '077 345 6789' && phoneDisplay('0112345678') === '011 234 5678' && phoneDisplay('+44 1') === '+44 1', 'shown as 077 345 6789');
}

console.log('\n== A new driver (validateNewDriver, randomPin) ==');
{
  check(USERNAME_RULE.test('nuwan.p') && USERNAME_RULE.test('a_b-c') && !USERNAME_RULE.test('ab') && !USERNAME_RULE.test('nuwan p') && !USERNAME_RULE.test('x'.repeat(41)), 'the username rule: 3–40 of letters, digits, dot, dash, underscore');
  check(isPin('123456') && !isPin('12345') && !isPin('1234567') && !isPin('12a456'), 'a PIN is exactly 6 digits');
  check(same(validateNewDriver(emptyDriver()), { error: 'fields' }), 'nothing typed: the fields');
  const f = { name: ' Nuwan Perera ', code: 'E0123', phone: '0771234567', username: 'nuwan.p', pin: '123456' };
  check(same(validateNewDriver({ ...f, username: 'nuwan p' }), { error: 'username' }), 'a bad username');
  check(same(validateNewDriver({ ...f, pin: '12345' }), { error: 'pin' }), 'a short PIN');
  check(same(validateNewDriver({ ...f, phone: ' ' }), { error: 'phone' }), 'the phone is needed');
  check(same(validateNewDriver(f), { input: { name: 'Nuwan Perera', code: 'E0123', username: 'nuwan.p', pin: '123456', phone: '0771234567' } }), 'create_driver\'s input, trimmed', validateNewDriver(f));
  let allPins = true;
  for (let i = 0; i < 200; i++) if (!isPin(randomPin())) allPins = false;
  check(allPins, '200 generated PINs are all 6 digits');
  check(randomPin(() => 0) === '000000' && randomPin(() => 0.999999999) === '999999', 'the PIN is padded to 6 digits');
}

console.log('\n== The driver\'s details editor ==');
{
  const profile: DriverProfile = {
    driver: { name: 'Kamal Perera', code: 'D-014', username: 'kamal.p', active: true, language: 'si', phone: '+94773456789', phone_display: '077 345 6789', links: { call: 'tel:+94773456789' }, current_vehicle: 'WP KV-7788', licence_chip: { chip: 'ok', expiry: '2027-03-12' } },
    emergency: { name: 'Sunethra', relation: 'wife', phone: '+94712223344', phone_display: '071 222 3344', links: { call: 'tel:+94712223344' } },
    licence: { number: 'B1234567', expiry: '2027-03-12', chip: 'ok', front_url: 'https://x/front' },
    this_month: { month: '2026-10', tasks: 12, km: 840 },
    not_available: [],
    missing: [],
    changes: [
      { field: 'licence_no', what: 'Licence number', to: 'B1234567', by: 'changed by Sahan', at: '2026-10-19 08:00' },
      { field: 'phone', what: 'Phone', from: '077 111 2222', to: '077 345 6789', by: 'changed by the driver', by_driver: true, at: '2026-10-18 22:40' },
    ],
  };
  const hidden: DriverProfile = { ...profile, emergency: undefined, licence: undefined, changes: undefined, private_hidden: 'The emergency contact and the licence are shown to people with users or vehicles.' };
  check(seesPrivate(profile) && !seesPrivate(hidden) && !seesPrivate(null), 'the private part is there only with the licence and no private_hidden');
  check(same(editableFields(profile), ['phone', 'whatsapp', 'emergency_name', 'emergency_relation', 'emergency_phone', 'licence_no', 'licence_expiry']), 'with the private part: every field');
  check(same(editableFields(hidden), ['phone', 'whatsapp', 'licence_expiry']), 'without it: the phone, WhatsApp and the expiry', editableFields(hidden));
  check(same(editableFields(null), ['phone', 'licence_expiry']), 'no profile (the list row): the phone and the expiry');
  const before = profileFields(profile);
  check(same(before, { phone: '077 345 6789', whatsapp: '', emergency_name: 'Sunethra', emergency_relation: 'wife', emergency_phone: '071 222 3344', licence_no: 'B1234567', licence_expiry: '2027-03-12' }), 'the fields start from the profile, the numbers as shown', before);
  check(same(profileFields(null, kamal), { phone: '077 345 6789', whatsapp: '', emergency_name: '', emergency_relation: '', emergency_phone: '', licence_no: '', licence_expiry: '2027-03-12' }), 'without the profile: the list row\'s phone (shown) and expiry', profileFields(null, kamal));
  check(same(profilePatch(before, before), { patch: {} }), 'nothing changed: an empty patch');
  check(same(profilePatch(before, { ...before, phone: '+94773456789' }), { patch: {} }), 'the same phone written another way is no change');
  check(same(profilePatch(before, { ...before, whatsapp: ' 077 999 8888 ', licence_no: '' }), { patch: { whatsapp: '077 999 8888', licence_no: null } }), 'a new WhatsApp trimmed, an emptied licence number null', profilePatch(before, { ...before, whatsapp: ' 077 999 8888 ', licence_no: '' }));
  check(same(profilePatch(before, { ...before, phone: '' }), { error: 'phoneEmpty' }), 'the phone cannot be emptied');
  check(same(profilePatch(before, { ...before, licence_expiry: '12/03/2027' }), { error: 'licenceDate' }), 'the expiry must be a date');
  check(same(profilePatch(before, { ...before, licence_expiry: '' }), { patch: { licence_expiry: null } }), 'an emptied expiry sends null');
  check(same(profilePatch(before, { ...before, emergency_name: 'X', phone: '077 000 0000' }, ['phone']), { patch: { phone: '077 000 0000' } }), 'only the keys asked are looked at');
  check(same(updateDriverInput('kamal.p', { phone: '077 000 0000' }), { username: 'kamal.p', phone: '077 000 0000' }), 'update_driver\'s input');
  check(latestDriverPhoneChange(profile.changes) === '2026-10-18 22:40', 'the driver\'s own phone change, when');
  check(latestDriverPhoneChange([{ field: 'phone', what: 'Phone', by: 'changed by Sahan', at: 'x' }]) === null && latestDriverPhoneChange(undefined) === null, 'an office change, or no changes: nothing');
  check(licencePhotos(profile.licence) === 1 && licencePhotos({ chip: 'ok', front_url: 'a', back_url: 'b' }) === 2 && licencePhotos(undefined) === 0, 'the photos counted');
  check(longDate(NAMES, '2027-03-12') === '12 Mar 2027' && longDate(NAMES, 'soon') === 'soon', '"12 Mar 2027"');
  check(whenText(NAMES, '2026-10-18 22:40') === 'Sun 18 Oct 22:40' && whenText(NAMES, 'yesterday') === 'yesterday', '"Sun 18 Oct 22:40"', whenText(NAMES, '2026-10-18 22:40'));
  check(same(licenceOf(profile, kamal), { expiry: '2027-03-12', chip: 'ok' }), 'the licence from the private part');
  check(same(licenceOf(hidden, null), { expiry: '2027-03-12', chip: 'ok' }), 'else the driver\'s chip');
  check(same(licenceOf(null, kamal), { expiry: '2027-03-12', chip: 'ok' }) && same(licenceOf(null, nimal), { expiry: null, chip: 'not set' }), 'else the list row, else not set');
  check(emergencyText(profile.emergency) === 'Sunethra (wife) · 071 222 3344', '"Sunethra (wife) · 071 222 3344"', emergencyText(profile.emergency));
  check(emergencyText({ name: 'Ruwan', phone: '+94711111111' }) === 'Ruwan · +94711111111' && emergencyText(undefined) === '', 'without a relation or display; nothing');
  const vehicles = [{ reg_no: 'WP KV-7788', make_model: 'Toyota HiAce', regular_driver: 'Kamal Perera' }, { reg_no: 'WP CAB-4521' }];
  check(regularVehicleOf(vehicles, 'kamal perera')?.reg_no === 'WP KV-7788' && regularVehicleOf(vehicles, 'Nimal') === undefined && regularVehicleOf(undefined, 'x') === undefined && regularVehicleOf(vehicles, '') === undefined, 'the regular vehicle by the driver\'s name');
}

console.log('\n== Office users ==');
{
  check(same(emptyUser().permissions, ['view']), 'a new user starts as a viewer');
  check(viewLocked(['view', 'request']) && !viewLocked(['view']) && !viewLocked([]), 'view is locked while another permission is on');
  check(same(togglePermission(['view'], 'approve'), ['view', 'approve']), 'ticking approve');
  check(same(togglePermission([], 'approve'), ['view', 'approve']), 'ticking approve brings view');
  check(same(togglePermission(['view', 'approve'], 'view'), ['view', 'approve']), 'view cannot leave while approve is on');
  check(same(togglePermission(['view', 'approve'], 'approve'), ['view']), 'unticking approve frees view');
  check(same(togglePermission(['view'], 'view'), []), 'view alone can be unticked');
  check(same(togglePermission(['users', 'view'], 'request'), ['view', 'request', 'users']), 'the table\'s order is kept');
  check(presetOf(['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues']) === 'fleet_admin', 'the Fleet admin preset');
  check(presetOf(['view', 'request', 'assign_tasks']) === 'dispatcher' && presetOf(['view', 'request']) === 'requester' && presetOf(['view']) === 'viewer', 'Dispatcher, Requester, Viewer');
  check(presetOf(['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users']) === 'all', 'everything = the "Everything" chip (never a role name)');
  check(presetOf(['view', 'approve']) === null && presetOf([]) === null, 'no preset for other lists');
  check(selfLockout('me@x.lk', 'ME@x.lk', ['view']) && selfLockout('me@x.lk', 'me@x.lk', ['view', 'users']) && !selfLockout('me@x.lk', 'other@x.lk', ['view']) && !selfLockout(undefined, 'me@x.lk', ['view']), 'nobody changes their own permissions (Round 2b), whatever they tick');
  check(presetOf(['view', 'request', 'assign_tasks', 'vehicles', 'issues', 'office_users']) === 'coordinator', 'the Coordinator preset (Round 2b)');
  {
    const co = { email: 'c@x.lk', permissions: ['view', 'request', 'assign_tasks', 'vehicles', 'issues', 'office_users'] };
    check(canChangeAccount(co, { email: 'r@x.lk', permissions: ['view', 'request'] }) && !canChangeAccount(co, { email: 'f@x.lk', permissions: ['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues'] })
      && canChangeAccount(co, { email: 'C@x.lk', permissions: co.permissions })
      && canChangeAccount({ email: 'a@x.lk', permissions: ['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users'] }, { email: 'c@x.lk', permissions: co.permissions }),
      'a Coordinator changes a requester, never a Fleet admin; an admin of before Round 2b changes a Coordinator (Checkpoint 2b review)');
    check(!canChangeAccount(co, { email: 'c2@x.lk', permissions: co.permissions }) && !canChangeAccount(co, { email: 'o@x.lk', permissions: ['view', 'office_users'] }),
      'the help-desk rule: Coordinator A never changes Coordinator B (it holds Office accounts)');
    check(same(givablePermissions(co.permissions), ['view', 'request', 'assign_tasks', 'vehicles', 'issues'])
      && same(givablePermissions(['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users']), ['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users', 'office_users']),
      'a Coordinator is offered only what they hold, never Office accounts, Users or Approve; an admin everything', givablePermissions(co.permissions));
  }
  check(presetOf(['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users', 'office_users']) === 'all', 'everything with office_users is still Everything');
  check(same(validateNewUser(emptyUser()), { error: 'fields' }), 'a new user needs a name and an e-mail');
  check(same(validateNewUser({ name: 'A', email: 'nope', phone: '', permissions: ['view'] }), { error: 'email' }), 'a bad e-mail');
  check(same(validateNewUser({ name: 'A', email: 'a@x.lk', phone: '', permissions: [] }), { error: 'permissions' }), 'at least one permission');
  check(same(validateNewUser({ name: ' Ann ', email: ' Ann@X.lk ', phone: ' 077 123 4567 ', permissions: ['approve'] }), { input: { name: 'Ann', email: 'ann@x.lk', permissions: ['view', 'approve'], phone: '077 123 4567' } }), 'create_office_user\'s input: trimmed, the e-mail lower-case, view added', validateNewUser({ name: ' Ann ', email: ' Ann@X.lk ', phone: ' 077 123 4567 ', permissions: ['approve'] }));
  check(!('phone' in (validateNewUser({ name: 'A', email: 'a@x.lk', phone: '', permissions: ['view'] }) as { input: Record<string, unknown> }).input), 'no phone typed: none sent');
  const before = { email: 'ann@x.lk', name: 'Ann', phone: '+94771234567', permissions: ['view', 'approve'] as const };
  check(same(updateUserInput(before, { name: 'Ann', email: 'ann@x.lk', phone: '077 123 4567', permissions: ['view', 'approve'] }), { nothing: true }), 'nothing changed (the phone written another way) = no call');
  check(same(updateUserInput(before, { name: ' Anne ', email: 'ann@x.lk', phone: '', permissions: ['approve', 'view'] }), { input: { email: 'ann@x.lk', name: 'Anne', phone: null } }), 'the name trimmed, the phone emptied = null, the permissions unchanged', updateUserInput(before, { name: ' Anne ', email: 'ann@x.lk', phone: '', permissions: ['approve', 'view'] }));
  check(same(updateUserInput(before, { name: 'Ann', email: 'ann@x.lk', phone: '077 123 4567', permissions: ['assign_tasks'] }), { input: { email: 'ann@x.lk', permissions: ['view', 'assign_tasks'] } }), 'new permissions: the full list, view added');
  check(same(updateUserInput(before, { name: 'Ann', email: 'ann@x.lk', phone: '077 123 4567', permissions: [] }), { error: 'permissionsOff' }), 'no permission left: switch off instead');
  const me = { email: 'me@x.lk', name: 'Me', phone: null, permissions: ['view', 'users'] as const };
  check(same(updateUserInput(me, { name: 'Me', email: 'me@x.lk', phone: '', permissions: ['view'] }, 'me@x.lk'), { error: 'selfLockout' }), 'a person cannot remove their own users permission');
  check(same(updateUserInput(me, { name: 'Me', email: 'me@x.lk', phone: '', permissions: ['view'] }, 'other@x.lk'), { input: { email: 'me@x.lk', permissions: ['view'] } }), 'another admin may');
  const u: OfficeUser = { name: 'Ann', email: 'ann@x.lk', phone: '+94771234567', role: 'x', permissions: ['approve'], active: true, connector_keys: [] };
  check(same(userFields(u, 'ann@x.lk'), { name: 'Ann', email: 'ann@x.lk', phone: '077 123 4567', permissions: ['view', 'approve'] }), 'the editor starts from the row, the number as shown, view added', userFields(u, 'ann@x.lk'));
}

console.log('\n== Quick settings ==');
{
  check(same(QUICK_SETTINGS.map((r) => r.key), ['tasks_need_approval', 'vehicle_on_the_day', 'planner_suggestions', 'driver_personal_trips', 'duty_cutoff', 'accept_within_min', 'accept_before_leave_min', 'office_phone', 'vehicle_check', 'trip_close_prompt', 'fuel_card', 'passengers', 'holder_contact']), 'the rows of section 4, the design\'s first, with the planner\'s switch (Round 1) and the five features (Round 4–7)');
  check(same(QUICK_SETTINGS.map((r) => r.kind), ['switch', 'switch', 'switch', 'choice', 'time', 'minutes', 'minutes', 'phone', 'switch', 'switch', 'switch', 'switch', 'switch']), 'their kinds');
  check(['vehicle_check', 'trip_close_prompt', 'fuel_card', 'passengers', 'holder_contact'].every((k) => switchValue(k as 'vehicle_check', {}, {}) === true) && switchValue('fuel_card', { fuel_card: false }, {}) === false, 'the five features: on when absent, off when saved off');
  check(same(PERSONAL_TRIPS, ['allowed', 'default', 'off', 'ask_first']), 'the four choices, the server\'s');
  const base: FleetSettings = { dwell_min: { default: 10 }, buffer_min: 10, base_place_id: null, avg_speed_kmh: 40, road_factor: 1.3, accept_within_min: 15, accept_before_leave_min: 30, rush_hour: { factor: 1.5, centre: { lat: 6.9, lng: 79.8 }, radius_km: 20, bands: [] } };
  check(switchValue('tasks_need_approval', {}, {}) === true && switchValue('vehicle_on_the_day', {}, {}) === false, 'nothing saved, no defaults: approval on, vehicle on the day off');
  check(switchValue('tasks_need_approval', { tasks_need_approval: false }, { tasks_need_approval: true }) === false && switchValue('vehicle_on_the_day', {}, { vehicle_on_the_day: true }) === true, 'the saved value, else the server\'s default');
  check(cutoffValue({}, {}) === '21:00' && cutoffValue({ duty_cutoff: '' }, { duty_cutoff: '21:00' }) === '' && cutoffValue({ duty_cutoff: '20:30' }) === '20:30', 'the auto clock-out: saved ("" = off), else the default, else 21:00');
  check(minutesValue('accept_within_min', {}, {}) === 15 && minutesValue('accept_before_leave_min', { accept_before_leave_min: 45 }) === 45 && minutesValue('accept_within_min', {}, { accept_within_min: 20 }) === 20, 'the accept window');
  check(personalTripsValue(undefined, undefined) === 'allowed' && personalTripsValue('off', 'allowed') === 'off' && personalTripsValue('weird', 'default') === 'default', 'the personal trips choice');
  check(officePhoneValue({ office_phone: '+94112345678' }) === '011 234 5678' && officePhoneValue({}) === '' && officePhoneValue(null) === '', 'the office phone as typed');
  const row = (key: (typeof QUICK_SETTINGS)[number]['key']) => QUICK_SETTINGS.find((r) => r.key === key)!;
  check(same(settingInput(row('tasks_need_approval'), true), { input: { key: 'tasks_need_approval', value: true } }) && same(settingInput(row('vehicle_on_the_day'), 'yes'), { input: { key: 'vehicle_on_the_day', value: false } }), 'a switch sends true or false, nothing else');
  check(same(settingInput(row('driver_personal_trips'), 'off'), { input: { key: 'driver_personal_trips', value: 'off' } }) && same(settingInput(row('driver_personal_trips'), 'maybe'), { error: 'choice' }), 'a choice among the four');
  check(same(settingInput(row('duty_cutoff'), '21:00'), { input: { key: 'duty_cutoff', value: '21:00' } }) && same(settingInput(row('duty_cutoff'), ''), { input: { key: 'duty_cutoff', value: '' } }), 'a time, or "" for off');
  check(same(settingInput(row('duty_cutoff'), '25:00'), { error: 'time' }) && same(settingInput(row('duty_cutoff'), '9:00'), { error: 'time' }), 'a bad time');
  check(isTime('09:30') && isTime('23:59') && !isTime('24:00') && !isTime('9:30') && !isTime(930), 'isTime');
  check(same(settingInput(row('accept_within_min'), '20'), { input: { key: 'accept_within_min', value: 20 } }) && same(settingInput(row('accept_before_leave_min'), 45), { input: { key: 'accept_before_leave_min', value: 45 } }), 'minutes from the text or a number');
  check(same(settingInput(row('accept_within_min'), '0'), { error: 'minutes' }) && same(settingInput(row('accept_within_min'), '1441'), { error: 'minutes' }) && same(settingInput(row('accept_within_min'), '1.5'), { error: 'minutes' }) && same(settingInput(row('accept_within_min'), ''), { error: 'minutes' }), 'whole minutes 1–1440 only');
  check(same(settingInput(row('office_phone'), '011 234 5678'), { input: { key: 'office_phone', value: '+94112345678' } }), 'the office phone sent as +94…');
  check(same(settingInput(row('office_phone'), ''), { input: { key: 'office_phone', value: null } }), 'an empty office phone clears it (null)');
  check(same(settingInput(row('office_phone'), '12'), { error: 'phone' }), 'a bad phone');
  const next = withSetting(base, 'duty_cutoff', '');
  check(next.duty_cutoff === '' && next.accept_within_min === 15, 'the saved value put in the settings shown');
}

console.log('\n== The screens as text ==');
{
  const people = 'app/office/people/';
  const files = {
    drivers: read(`${people}drivers.tsx`),
    driver: read(`${people}driver/[username].tsx`),
    driverNew: read(`${people}driver-new.tsx`),
    users: read(`${people}users.tsx`),
    user: read(`${people}user/[email].tsx`),
    userNew: read(`${people}user-new.tsx`),
    settings: read(`${people}settings.tsx`),
    parts: read('components/office/PeopleParts.tsx'),
  };
  const logic = read('office/peopleLogic.ts');
  check(!/from 'react-native'|from "react-native"/.test(logic), 'peopleLogic.ts imports nothing from react-native');

  check(files.drivers.includes("useTool<DriversList>('list_drivers'") && files.drivers.includes("'create_driver'") && files.drivers.includes('/office/people/driver-new') && files.drivers.includes("'/office/people/driver/[username]'"), 'Drivers: list_drivers, + Add driver only with create_driver, a row opens the driver');
  const driversCode = files.drivers.replace(/\/\/.*$/gm, '');
  check(driversCode.includes('appendDrivers') && driversCode.includes('d.next') && !driversCode.includes('include_inactive') && driversCode.includes("driversArgs(search, filter === 'all'"), 'Drivers: Load more on the cursor; the switched-off chip only through driversArgs');
  check(files.drivers.includes('<FilterBar') && files.drivers.includes('defs={peopleDriverDefs(t)}') && !files.drivers.includes('FilterChips') && !files.drivers.includes('SearchBox') && files.drivers.includes('<SkeletonRows') && files.drivers.includes('<LoadMore') && !files.drivers.includes('<Loading'), 'Drivers: the search bar and one Filter button (Active / With switched off), skeleton rows, Load more');
  check(files.users.includes('<FilterBar search={text}') && !files.users.includes('SearchBox') && files.users.includes('<SkeletonRows') && files.users.includes('<LoadMore') && !files.users.includes('<Loading'), 'Office users: the search bar (no filters), skeleton rows, Load more');
  check([files.driver, files.user].every((f) => f.includes('<SkeletonRows') && f.includes('<ListFailed') && !f.includes('<Loading')), 'Manage a driver / an office user: skeleton rows first, the error with Try again');
  check(files.driver.includes("'driver_profile'") && files.driver.includes("'list_drivers', { search: username, include_inactive: true, limit: 25 }"), 'Manage a driver: driver_profile and the driver\'s row of list_drivers');
  for (const tool of ['update_driver', 'reset_pin', 'set_driver_active', 'driver_route', 'drivers_board', 'list_vehicles']) {
    check(files.driver.includes(`me.tools.includes('${tool}')`), `Manage a driver: ${tool} only when the person has it`);
  }
  check(files.driver.includes("api.call('update_driver', updateDriverInput(") && files.driver.includes("api.call('reset_pin', { username, pin: value })") && files.driver.includes("'set_driver_active', { username, active: want }"), 'Manage a driver: the three writes with their inputs');
  check(files.driver.includes("'/office/driver/[username]'") && files.driver.includes("'/office/(tabs)/drivers'"), 'Today\'s route → the driver\'s page; This week → the Drivers board');
  check(files.driver.includes('latestDriverPhoneChange') && files.driver.includes('phoneChangedByDriver'), 'the amber "Phone changed by the driver" line');
  check(!/console\.log/.test(files.driver) && !/console\.log/.test(files.driverNew) && !/console\.log/.test(files.user) && !/console\.log/.test(files.userNew) && !/console\.log/.test(files.parts), 'no PIN or link is ever logged');
  check(files.driverNew.includes("api.call('create_driver', v.input)") && files.driverNew.includes('randomPin()') && files.driverNew.includes('validateNewDriver'), 'Add a driver: create_driver, Generate, the rules');
  check(files.users.includes("useTool<OfficeUsers>('list_office_users'") && files.users.includes("'create_office_user'") && files.users.includes('/office/people/user-new') && files.users.includes("'/office/people/user/[email]'") && files.users.includes('appendUsers'), 'Office users: list_office_users, + Add only with create_office_user, a row opens the user, Load more');
  check(files.user.includes("'list_office_users', { search: email, limit: 25 }") && files.user.includes("api.call<UpdateOfficeUserResult>('update_office_user', v.input)") && files.user.includes("'reset_office_password', { email }") && files.user.includes("'set_office_user_active', { email, active: want }"), 'Manage an office user: the row by search, the three writes');
  for (const tool of ['update_office_user', 'reset_office_password', 'set_office_user_active']) {
    check(files.user.includes(`me.tools.includes('${tool}')`), `Manage an office user: ${tool} only when the person has it`);
  }
  check(files.user.includes('updateUserInput(before, f, me.email)') && files.user.includes('SecretCard') && files.parts.includes('Share.share({ message: text })') && files.parts.includes('navigator.clipboard.writeText(text)'), 'the rules with the person\'s own e-mail; the link shown once with Share');
  check(files.userNew.includes("api.call<CreateOfficeUserResult>('create_office_user', v.input)") && files.userNew.includes('PermissionPicker') && files.userNew.includes('SecretCard'), 'Add an office user: create_office_user, the picker, the link shown once');
  check(files.parts.includes('togglePermission') && files.parts.includes('presetOf') && files.parts.includes('viewLocked') && files.parts.includes('PRESET_KEYS') && files.parts.includes("t('office.people.presetAdmin')"), 'the picker: the presets and Everything, view locked');
  check(files.settings.includes("useTool<SettingsResult>('get_settings', {})") && files.settings.includes("api.call('update_settings', r.input)") && files.settings.includes("me.tools.includes('update_settings')"), 'Quick settings: get_settings, update_settings {key, value}, the controls only with update_settings');
  check(files.settings.includes("t('office.more.laptopOnly')"), 'the laptop-only line');
  check(files.settings.includes('TimeField') && files.settings.includes("save('duty_cutoff', v)") && files.settings.includes("save('driver_personal_trips', v)") && files.settings.includes("save('office_phone', phoneShown)"), 'the cutoff through TimeInput, the choice, the phone');

  const ROLE = /'(admin|fleet_admin|office|viewer|staff)'|"(admin|fleet_admin|office|viewer|staff)"|me\.role|\.role\b/;
  for (const [name, text] of Object.entries(files)) {
    const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    check(!ROLE.test(code), `${name}: no role names, everything by permission and tools`);
  }
}

console.log('\n== The strings (office.people in en.json and si.json; the sidecar was merged by the lead) ==');
{
  const lang = (f: string) => JSON.parse(readFileSync(join(SRC, 'i18n', f), 'utf8')) as { office: { people: Record<string, unknown> } };
  const side = { en: lang('en.json'), si: lang('si.json') };
  const flat = (o: Record<string, unknown>, prefix = ''): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string') out[`${prefix}${k}`] = v;
      else if (v && typeof v === 'object') Object.assign(out, flat(v as Record<string, unknown>, `${prefix}${k}.`));
    }
    return out;
  };
  const en = flat(side.en.office.people);
  const si = flat(side.si.office.people);
  check(Object.keys(en).length > 100, `${Object.keys(en).length} English keys`);
  const missingSi = Object.keys(en).filter((k) => !(k in si));
  const extraSi = Object.keys(si).filter((k) => !(k in en));
  check(missingSi.length === 0, 'every English key has its Sinhala', missingSi);
  check(extraSi.length === 0, 'no Sinhala key without its English', extraSi);
  const vars = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  const differ = Object.keys(en).filter((k) => k in si && vars(en[k]) !== vars(si[k]));
  check(differ.length === 0, 'the same placeholders in both languages', differ);
  const sinhalaDigits = Object.entries(si).filter(([, v]) => /[෦-෯]/.test(v)).map(([k]) => k);
  check(sinhalaDigits.length === 0, 'no Sinhala digits (numbers stay Latin)', sinhalaDigits);
  const emptySi = Object.entries(si).filter(([, v]) => v.trim() === '').map(([k]) => k);
  check(emptySi.length === 0, 'no empty Sinhala string', emptySi);

  // Every office.people.* key the code uses (literal keys, and the template keys with their known tails).
  // The Filter sheet's words come from peopleLogic.ts (peopleDriverDefs), so it is read too.
  const code = ['drivers.tsx', 'driver/[username].tsx', 'driver-new.tsx', 'users.tsx', 'user/[email].tsx', 'user-new.tsx', 'settings.tsx'].map((f) => read(`app/office/people/${f}`)).join('\n') + read('components/office/PeopleParts.tsx') + read('office/peopleLogic.ts');
  const used = new Set<string>();
  for (const m of code.matchAll(/office\.people\.([A-Za-z0-9_.]+)/g)) used.add(m[1]);
  // The keys built at run time: `office.people.${pill.key}`, driverErr.${problem}, userErr.${problem}, err.${problem}, field.${k}, trips.${v} / ${v}Hint.
  const dynamic: string[] = [
    'active', 'off',
    ...['fields', 'username', 'pin', 'phone'].map((k) => `driverErr.${k}`),
    ...['fields', 'email', 'permissions', 'permissionsOff', 'selfLockout'].map((k) => `userErr.${k}`),
    ...['phoneEmpty', 'licenceDate', 'time', 'minutes', 'phone', 'choice'].map((k) => `err.${k}`),
    ...['phone', 'whatsapp', 'emergency_name', 'emergency_relation', 'emergency_phone', 'licence_no', 'licence_expiry'].map((k) => `field.${k}`),
    ...PERSONAL_TRIPS.flatMap((v) => [`trips.${v}`, `trips.${v}Hint`]),
  ];
  for (const k of dynamic) used.add(k);
  const literal = [...used].filter((k) => !k.endsWith('.') && !k.includes('${'));
  const missing = literal.filter((k) => !(k in en));
  check(missing.length === 0, `every key the code uses (${literal.length}) is in the sidecar`, missing);
  const unused = Object.keys(en).filter((k) => !used.has(k));
  check(unused.length === 0, 'no key in the sidecar that nothing uses', unused);
}

console.log('\nRound 49: how long a set-password link works, in both languages');
{
  const lang = (f: string) => JSON.parse(readFileSync(join(SRC, 'i18n', f), 'utf8')) as { office: { people: Record<string, string> } };
  for (const [code, words] of [['en', lang('en.json')], ['si', lang('si.json')]] as const) {
    const t = (k: string, v: Record<string, string | number> = {}) =>
      (words.office.people[k.replace('office.people.', '')] ?? k).replace(/\{(\w+)\}/g, (_, n: string) => String(v[n] ?? ''));
    const hint = t('office.people.linkValid', { for: linkValidWords(t, '7 days'), name: 'Shashen' });
    check(code === 'en' ? hint.startsWith('Valid for 7 days, until the password is saved.') : hint.startsWith('මුරපදය සුරකින තෙක් දින 7 ක් වලංගුයි.'),
      `${code}: "7 days" from the server in the person's words`, hint);
    check(linkValidWords(t, undefined) === t('office.people.linkDays', { n: '7' }) && linkValidWords(t, '1 hour') === '1 hour',
      `${code}: no answer = the 7 days; other words as sent`);
  }
  for (const screen of ['app/office/people/user-new.tsx', 'app/office/people/user/[email].tsx']) {
    check(read(screen).includes('linkValidWords(t, ') && !read(screen).includes("?? '1 hour'"), `${screen}: the link's days in words, no "1 hour" left`);
  }
}

console.log(failures === 0 ? '\nAll people checks passed.' : `\n${failures} people check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
