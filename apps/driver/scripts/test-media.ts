// Stage 1 item 5 (O3): photos and documents by camera in Office mode (office/mediaLogic.ts and the screens).
//
//   npm run test:media          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  canSetDriverPhoto, canSetLicencePhoto, canSetVehiclePhoto, canUploadDocs, centredSquare, DOC_PX, docKindOf, docSaveBlock, documentRows, EXPIRES,
  fitLongSide, LICENCE_PX, LONG_SIDE, MAX_DOC_BYTES, PROFILE_PX, saveDocInput, signedUploadUrl, THUMB_PX, ticketOf, VEHICLE_PX,
} from '../src/office/mediaLogic';
import type { VehicleDocument } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

console.log('\nThe sizes (the same as the website)');
{
  const web = readFileSync(join(__dirname, '..', '..', 'office', 'src', 'screens', 'mediaLogic.ts'), 'utf8');
  const num = (name: string) => Number(new RegExp(`export const ${name} = ([\\d* ]+);`).exec(web)?.[1].split('*').reduce((a, b) => a * Number(b.trim()), 1));
  check(PROFILE_PX === num('PROFILE_PX') && VEHICLE_PX === num('VEHICLE_PX') && THUMB_PX === num('THUMB_PX') && LICENCE_PX === num('LICENCE_PX') && DOC_PX === num('DOC_PX') && MAX_DOC_BYTES === num('MAX_DOC_BYTES'),
    'a 512 px square, 1600 px vehicle + 256 px thumbnail, 1600 px licence, 2000 px document, 10 MB: the website\'s numbers');
  check(LONG_SIDE.vehicle === 1600 && LONG_SIDE.driver_licence === 1600 && LONG_SIDE.document === 2000, 'the long side by use');
  check(same(fitLongSide(4000, 3000, 1600), { width: 1600 }) && same(fitLongSide(3000, 4000, 2000), { height: 2000 }) && fitLongSide(1200, 900, 1600) === null && fitLongSide(0, 0, 10) === null,
    'resized to the long side, never made bigger');
  check(same(centredSquare(4000, 3000), { originX: 500, originY: 0, width: 3000, height: 3000 }) && centredSquare(500, 500) === null, 'the centred square for a driver\'s photo');
}

console.log('\nThe upload');
{
  const ticket = { bucket: 'vehicle-docs' as const, path: 'v1/doc one.jpg', token: 'a+b/c' };
  check(signedUploadUrl('https://x.supabase.co/', ticket) === 'https://x.supabase.co/storage/v1/object/upload/sign/vehicle-docs/v1/doc%20one.jpg?token=a%2Bb%2Fc',
    "Storage's signed upload address (as supabase-js uploadToSignedUrl: PUT /object/upload/sign/<bucket>/<path>?token=)");
  check(same(ticketOf({ bucket: 'driver-photos', path: 'p', token: 't', extra: 1 }), { bucket: 'driver-photos', path: 'p', token: 't' }) && ticketOf({ bucket: 'other', path: 'p', token: 't' }) === null && ticketOf(null) === null && ticketOf({ bucket: 'vehicle-photos', path: '', token: 't' }) === null,
    'a ticket only as the server sent it (a known bucket, a path, a token)');
  const media = src('office/media.ts');
  const fileNative = src('office/mediaFile.ts');
  const fileWeb = src('office/mediaFile.web.ts');
  check(fileNative.includes("httpMethod: 'PUT'") && fileNative.includes('UploadType.BINARY_CONTENT') && fileWeb.includes("method: 'PUT'") && media.includes("'x-upsert': 'false'") && !/service_role|SERVER_KEY/.test(media + fileNative + fileWeb), 'PUT the file\'s bytes (the phone through expo-file-system, a browser through fetch), never overwrite, only the publishable key');
  check(media.includes('requestCameraPermissionsAsync') && media.includes('launchImageLibraryAsync') && media.includes("allowsEditing: true, aspect: [1, 1]"), 'the camera (asked) or the phone\'s photos; a driver\'s photo cropped square');
}

console.log('\nWho sees which button');
{
  const all = ['photo_upload_url', 'set_driver_photo', 'set_vehicle_photo', 'set_driver_licence_photo', 'vehicle_document_upload_url', 'save_vehicle_document'];
  check(canSetDriverPhoto(all) && canSetVehiclePhoto(all) && canSetLicencePhoto(all) && canUploadDocs(all), 'with both tools of each pair: every button');
  check(!canSetDriverPhoto(['set_driver_photo']) && !canSetVehiclePhoto(['photo_upload_url']) && !canUploadDocs(['save_vehicle_document']) && !canSetLicencePhoto([]), 'one tool of a pair: no button (no dead UI)');
}

console.log("\nA vehicle's documents");
{
  const doc = (kind: VehicleDocument['kind'], id: string = kind) => ({ id, kind, kind_name: kind, content_type: 'image/jpeg', uploaded: 'x' }) as VehicleDocument;
  const rows = documentRows({ documents: [doc('insurance'), doc('other', 'o1')], missing: ['revenue_licence'] }, { rented: false });
  check(rows.map((r) => r.key).join() === 'revenue_licence,insurance,emission,registration,other:o1,other:new', 'the four kinds, each Other, then Another document', rows.map((r) => r.key));
  check(rows[0].missing && !rows[1].missing && rows[1].doc?.id === 'insurance' && rows[rows.length - 1].adding, 'missing marked, the current file kept, the last row adds');
  check(documentRows({ documents: [], missing: [] }, { rented: true }).some((r) => r.kind === 'lease'), 'the lease only for a rented vehicle (or one on file)');
  check(EXPIRES.insurance && EXPIRES.revenue_licence && EXPIRES.emission && !EXPIRES.registration && !EXPIRES.other, 'the kinds with an expiry');
  check(same(saveDocInput({ vehicle: 'WP CAB-1', kind: 'insurance', path: 'p', contentType: 'image/jpeg', bytes: 9, expiry: '2027-03-12', name: 'x' }), { vehicle: 'WP CAB-1', kind: 'insurance', path: 'p', content_type: 'image/jpeg', bytes: 9, expiry: '2027-03-12' })
    && same(saveDocInput({ vehicle: 'V', kind: 'other', path: 'p', contentType: 'image/jpeg', bytes: 1, expiry: '2027-01-01', name: '  Fitness  ' }), { vehicle: 'V', kind: 'other', path: 'p', content_type: 'image/jpeg', bytes: 1, name: 'Fitness' }),
    "save_vehicle_document's input: the expiry only where it belongs, the name only for Other");
  check(docSaveBlock({ kind: 'insurance', hasPhoto: false, name: '', bytes: 0 }) === 'photo' && docSaveBlock({ kind: 'other', hasPhoto: true, name: ' ', bytes: 1 }) === 'name'
    && docSaveBlock({ kind: 'emission', hasPhoto: true, name: '', bytes: MAX_DOC_BYTES + 1 }) === 'tooBig' && docSaveBlock({ kind: 'insurance', hasPhoto: true, name: '', bytes: 1 }) === null, 'Save waits with its reason');
  check(docKindOf('insurance') === 'insurance' && docKindOf('drop table') === 'other' && docKindOf(undefined) === 'other', "a broken link's kind opens Other's form");
}

console.log('\nThe screens');
{
  const vehicle = src('app/office/vehicles/[reg].tsx');
  check(vehicle.includes('<PhotoPick use="vehicle"') && vehicle.includes("'photo_upload_url', { kind: 'vehicle', target: reg }") && vehicle.includes("'set_vehicle_photo', { vehicle: reg, path: main.path, thumb_path: thumb.path }"),
    "the vehicle's photo: both files to Storage, then set_vehicle_photo");
  check(vehicle.includes('documentRows(docsQ.data') && vehicle.includes("pathname: '/office/vehicles/doc'") && !vehicle.includes('filesLaptop'), 'a row per document kind opens its screen; no "laptop" note');
  const doc = src('app/office/vehicles/doc.tsx');
  check(doc.includes("'vehicle_document_upload_url', { vehicle: reg, kind, content_type: 'image/jpeg', bytes: shot.photo.bytes }") && doc.includes("api.call('save_vehicle_document', saveDocInput(") && doc.includes('<StickyActions>') && doc.includes('disabled={!!block}') && doc.includes('office.media.block_'),
    'the document screen: a place, the file, save_vehicle_document; Save sticky, disabled with its reason');
  check(doc.includes('<DateField label={t(\'office.media.expiry\')}') && !/YYYY/.test(doc), 'the expiry on the calendar');
  const driver = src('app/office/people/driver/[username].tsx');
  check(driver.includes("kind = job.which === 'photo' ? 'driver_profile' : 'driver_licence'") && driver.includes("api.call('set_driver_photo'") && driver.includes("api.call('set_driver_licence_photo', { driver: username, side: job.which, path: ticket.path })"),
    "a driver's photo and the licence's front and back");
  check(driver.includes("k === 'licence_expiry' ? (") && driver.includes('<DateField') && !driver.includes("'YYYY-MM-DD'"), "Manage a driver: the licence expiry on the calendar");
  check(src('app/profile-edit.tsx').includes('<DateField label={t(\'profile.licenceExpiry\')}'), "the driver's own profile: the licence expiry on the calendar (Stage 0)");
  const pick = src('components/office/PhotoPick.tsx');
  check(pick.includes("pick('camera')") && pick.includes("pick('library')") && pick.includes('Linking.openSettings()'), 'Take photo and Choose from photos; a camera not allowed says how to allow it');
  const en = JSON.parse(src('i18n/en.json'));
  const si = JSON.parse(src('i18n/si.json'));
  const keys = Object.keys(en.office.media);
  const used = [doc, vehicle, driver, pick].join('\n');
  check(keys.every((k) => typeof si.office.media[k] === 'string'), 'office.media in both languages', keys.filter((k) => typeof si.office.media[k] !== 'string'));
  const asked = [...used.matchAll(/office\.media\.([a-zA-Z_]+)/g)].map((m) => m[1]).filter((k) => !k.endsWith('_'));
  check(asked.every((k) => k in en.office.media), 'every key asked for exists', asked.filter((k) => !(k in en.office.media)));
  check(['photo', 'name', 'tooBig'].every((k) => `block_${k}` in en.office.media) && ['revenue_licence', 'insurance', 'emission', 'registration', 'lease', 'other'].every((k) => `kind_${k}` in si.office.media), 'the reasons and the kinds');
}

console.log(failures === 0 ? '\nAll media checks passed.' : `\n${failures} media check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
