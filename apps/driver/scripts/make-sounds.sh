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
# From the 1.3.0 build (Phase 7, Part 6), OGG Vorbis to stay small:
#   task_ring.ogg     the new-task ringtone: a fast two-note ring for 1.2 s in every 2 s, for 30 s (the channel
#                     "task-ring"; the app clears the notification, and the ring with it, when the driver opens the task)
#   task_update.ogg   a task changed or cancelled: three falling notes, twice, unlike any other (the channel "task-updates")
#   office_ask.ogg    a question from the office: a rising question-like pair, twice (the channel "office-asks")
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

# ogg <file> <duration> <amplitude*expression>: any ffmpeg aevalsrc expression, as OGG Vorbis (a 30 s ring stays small).
ogg() {
  local file=$1 duration=$2 expr=$3
  ffmpeg -loglevel error -y -f lavfi -i "aevalsrc='$expr':s=44100:d=$duration" \
    -ac 1 -ar 44100 -c:a libvorbis -q:a 4 "assets/sounds/$file"
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

# The ring: in each 2 s, 1.2 s of notes 0.12 s long alternating 880 and 1175 Hz (each with its own sine envelope), then
# 0.8 s of quiet; 30 s in all.
ogg task_ring.ogg 30 "0.9*if(lt(mod(t,2),1.2),sin(2*PI*if(eq(mod(floor(t/0.12),2),0),880,1175)*t)*abs(sin(PI*t/0.12)),0)"
# A change: 1047, 784, 587 Hz falling (0.14 s each), then again after a pause.
ogg task_update.ogg 1.6 "0.85*(if(between(t,0,0.14),sin(2*PI*1047*t)*sin(PI*t/0.14),0)+if(between(t,0.18,0.32),sin(2*PI*784*t)*sin(PI*(t-0.18)/0.14),0)+if(between(t,0.36,0.5),sin(2*PI*587*t)*sin(PI*(t-0.36)/0.14),0)+if(between(t,0.9,1.04),sin(2*PI*1047*t)*sin(PI*(t-0.9)/0.14),0)+if(between(t,1.08,1.22),sin(2*PI*784*t)*sin(PI*(t-1.08)/0.14),0)+if(between(t,1.26,1.4),sin(2*PI*587*t)*sin(PI*(t-1.26)/0.14),0))"
# A question: 659 then 988 Hz (the second longer), twice.
ogg office_ask.ogg 1.5 "0.8*(if(between(t,0,0.12),sin(2*PI*659*t)*sin(PI*t/0.12),0)+if(between(t,0.15,0.4),sin(2*PI*988*t)*sin(PI*(t-0.15)/0.25),0)+if(between(t,0.8,0.92),sin(2*PI*659*t)*sin(PI*(t-0.8)/0.12),0)+if(between(t,0.95,1.2),sin(2*PI*988*t)*sin(PI*(t-0.95)/0.25),0))"
