#!/usr/bin/env bash
# Makes the app's own notification and in-app sounds with ffmpeg (pure tones,
# nothing downloaded, nothing copied from another app). Writes WAV files to
# assets/sounds/; run it again whenever a sound should change.
#
#   new_task.wav      a loud rising two-note ring, four times (about 3 s)
#   task_changed.wav  two short double beeps
#   general.wav       one soft note
#   task_start.wav    two quick rising notes (played in the app on Start task)
#   task_done.wav     three rising notes (played in the app on Save & finish task)
#
# Usage: apps/driver/scripts/make-sounds.sh

set -euo pipefail
cd "$(dirname "$0")/.."
command -v ffmpeg >/dev/null || { echo "ffmpeg is needed (sudo apt install ffmpeg)" >&2; exit 2; }
mkdir -p assets/sounds

# tone <file> <duration> <amplitude> <notes...>, each note "start:length:hz".
# Every note has a sine envelope, so there are no clicks.
tone() {
  local file=$1 duration=$2 amplitude=$3
  shift 3
  local expr=""
  for note in "$@"; do
    IFS=: read -r start len hz <<<"$note"
    expr+="${expr:++}if(between(t,$start,$start+$len),sin(2*PI*$hz*t)*sin(PI*(t-$start)/$len),0)"
  done
  ffmpeg -loglevel error -y -f lavfi -i "aevalsrc='$amplitude*($expr)':s=44100:d=$duration" \
    -ac 1 -ar 44100 -c:a pcm_s16le "assets/sounds/$file"
  echo "  $file  $(du -h "assets/sounds/$file" | cut -f1)"
}

echo "Making sounds in assets/sounds/"
tone new_task.wav 3.0 0.9 \
  0:0.16:880 0.22:0.16:1319 \
  0.75:0.16:880 0.97:0.16:1319 \
  1.5:0.16:880 1.72:0.16:1319 \
  2.25:0.16:880 2.47:0.16:1319
tone task_changed.wav 1.4 0.8 0:0.14:587 0.2:0.14:587 0.7:0.14:587 0.9:0.14:587
tone general.wav 0.6 0.6 0:0.3:523
tone task_start.wav 0.45 0.7 0:0.12:523 0.15:0.2:784
tone task_done.wav 0.8 0.7 0:0.12:784 0.15:0.12:1047 0.3:0.35:1319
