// Short sounds the app plays itself: when a task is started and when it is
// finished. The files are made by scripts/make-sounds.sh. Notification
// sounds are not played here; Android plays those from the channel.

import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

const SOURCES = {
  start: require('../../assets/sounds/task_start.wav') as number,
  done: require('../../assets/sounds/task_done.wav') as number,
};

let modeSet = false;

export async function playSound(name: keyof typeof SOURCES): Promise<void> {
  try {
    if (!modeSet) {
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
      modeSet = true;
    }
    const player = createAudioPlayer(SOURCES[name]);
    player.play();
    setTimeout(() => player.remove(), 3000);
  } catch {
    // A missing sound is not worth an error.
  }
}
