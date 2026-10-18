// Config plugin for every build (Phase 7, Part 6; docs/phase7-plan.md §27): the notification sounds are kept through
// resource shrinking. A channel names its sound (app.json, expo-notifications' sounds) and no code does, so a release build
// with resource shrinking drops some of them: the 1.2.0 build lost new_task.wav and general.wav, and their channels play
// the phone's default sound. This writes android/app/src/main/res/raw/fame_sounds_keep.xml (its own name: React Native's
// bundled-assets keep file is raw/keep) with every sound app.json lists.

const { withDangerousMod } = require('expo/config-plugins');
const { mkdirSync, writeFileSync } = require('node:fs');
const { basename, extname, join } = require('node:path');

/** The raw resource names of the notification sounds app.json lists ("./assets/sounds/new_task.wav" → "new_task"). */
function soundNames(config) {
  const entry = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
  const sounds = (Array.isArray(entry) && entry[1]?.sounds) || [];
  return sounds.map((f) => basename(f, extname(f)));
}

const keepXml = (names) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Added by plugins/withKeptSounds.js: the notification channels' sounds, named only by the channels. -->
<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="${names.map((n) => `@raw/${n}`).join(',')}" />
`;

module.exports = function withKeptSounds(config) {
  const sounds = soundNames(config);
  return withDangerousMod(config, [
    'android',
    (c) => {
      if (sounds.length === 0) return c;
      const raw = join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      mkdirSync(raw, { recursive: true });
      writeFileSync(join(raw, 'fame_sounds_keep.xml'), keepXml(sounds));
      return c;
    },
  ]);
};

module.exports.soundNames = soundNames;
