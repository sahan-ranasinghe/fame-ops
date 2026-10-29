// Release 1.4.0 (docs/release-1.4.0.md item 2): the fuel video played in the app (office/fuelPlayer.ts,
// app/office/fuel-video.tsx). The bookmark rule (the site's fuelLogic.pieceAt), the pieces and the start piece, the hand-over,
// the two screens that open the player instead of the browser, and the words in both languages.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { handToPlayer, markChips, pieceAt, playerFill, playerPieces, startPiece } from '../src/office/fuelPlayer';
import type { VideoCard } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `\n        ${JSON.stringify(detail)}`}`);
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const two: VideoCard = {
  status: 'uploaded',
  duration_s: 300,
  interrupted: true,
  segments: [{ url: 'https://x.test/a.mp4', duration_s: 120 }, { url: 'https://x.test/b.mp4', duration_s: 180 }],
  marks: [
    { key: 'plate', label: 'Plate', at_s: 4, clock: '0:04' },
    { key: 'final', label: 'Final', at_s: 232, clock: '3:52' },
  ],
};

console.log('\nThe bookmarks: the right piece, then the second within it');
check(same(pieceAt(4, two.segments!), { piece: 0, offset: 4 }), 'Plate 0:04: piece 1 at 4 s');
check(same(pieceAt(232, two.segments!), { piece: 1, offset: 112 }), 'Final 3:52: piece 2 at 1:52 (232 − 120)');
check(same(pieceAt(999, two.segments!), { piece: 1, offset: 879 }), 'past the end: the last piece');
check(same(pieceAt(30, [{ duration_s: 60 }]), { piece: 0, offset: 30 }), 'one piece: that piece');
check(same(markChips(two).map((m) => m.label), ['Plate 0:04', 'Final 3:52']), 'the chips say the step and its time');

console.log('\nThe pieces and where the player starts');
check(playerPieces(two).length === 2 && playerPieces({ status: 'uploaded', url: 'https://x.test/one.mp4' }).length === 1
  && playerPieces({ status: 'recorded' }).length === 0 && playerPieces({ status: 'uploaded', url: 'http://x.test/plain' }).length === 0,
  'every uploaded piece with an https link; none for a video still on the phone or a link that is not https');
check(startPiece(two, 2) === 1 && startPiece(two, 1) === 0 && startPiece(two, 9) === 1 && startPiece(two, 0) === 0,
  'the piece tapped (1-based) is where it starts, kept inside the pieces there are');

console.log('\nThe hand-over: in memory, never the links in an address');
check(playerFill() === null, 'nothing handed: the player says the video is no longer open');
handToPlayer({ title: 'Today 09:12', sub: 'WP CAB-4521 · Kamal', video: two, start: 1 });
check(playerFill()?.start === 1 && playerFill()?.video === two, 'the fill handed over is the one the player shows');
const reports = read('app/office/reports/index.tsx');
const task = read('app/office/task/[id].tsx');
check(/handToPlayer\(/.test(reports) && /router\.push\('\/office\/fuel-video'\)/.test(reports) && !/Linking\.openURL\(piece\.url\)/.test(reports),
  'Reports → Fuel opens the player (no longer the browser), after its 50-minute link check');
check(/handToPlayer\(/.test(task) && /router\.push\('\/office\/fuel-video'\)/.test(task) && /if \(!fill\?\.video\) return openUrl\(url\)/.test(task),
  'a task\'s fuel video opens the player; its photos and receipts still open as links');
const player = read('app/office/fuel-video.tsx');
check(/useVideoPlayer/.test(player) && /nativeControls/.test(player) && /'playToEnd'/.test(player) && /fuel-video-browser/.test(player),
  'the player: expo-video with the native controls, the pieces one after another, Open in the browser kept');

console.log('\nThe words in both languages');
const lang = (f: string) => JSON.parse(readFileSync(join(SRC, 'i18n', f), 'utf8')) as { office: { video: Record<string, string>; reports: Record<string, string> } };
const en = lang('en.json');
const si = lang('si.json');
check(same(Object.keys(en.office.video).sort(), Object.keys(si.office.video).sort()) && Object.keys(en.office.video).length === 9
  && Object.values(si.office.video).every((v) => /[඀-෿]/.test(v)),
  'office.video: nine words, each in Sinhala too');
check(!!en.office.reports.videosInApp && !!si.office.reports.videosInApp && reports.includes("t('office.reports.videosInApp')"),
  'the Fuel list says a video plays in the app');

console.log(failures === 0 ? '\nAll fuel player checks passed.' : `\n${failures} fuel player check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
