#!/usr/bin/env bash
# The two office sounds for 1.4.0 (Sahan, 21 October 2026; docs/release-1.4.0.md): original synthesised tones (pure sines
# with a sine envelope, as scripts/make-sounds.sh makes the six in 1.3.0), under 2 s, as loud as those. Shipped in 1.4.0:
# assets/sounds/ (app.json's expo-notifications sounds, kept by plugins/withKeptSounds.js), the sounds of the channels
# office-requests-2 and office-issues-2 (lib/channels.ts).
#
#   request_waiting.ogg  a request to approve, a task that needs a driver: a bright rising C–E–G, twice ("decide this")
#   issue_critical.ogg   a critical issue: quick alternating high–low pulses, twice (an alarm, unlike every other tone)
set -euo pipefail
cd "$(dirname "$0")/.."
command -v ffmpeg >/dev/null || { echo "ffmpeg is needed" >&2; exit 2; }
mkdir -p assets/sounds

note() { # start length hz → one enveloped sine
  echo "if(between(t,$1,$1+$2),sin(2*PI*$3*t)*sin(PI*(t-$1)/$2),0)"
}
ogg() { # file duration amplitude expression
  ffmpeg -loglevel error -y -f lavfi -i "aevalsrc='$3*($4)':s=44100:d=$2" -ac 1 -ar 44100 -c:a libvorbis -q:a 4 "assets/sounds/$1"
  echo "  $1  $(du -h "assets/sounds/$1" | cut -f1)"
}

# Rising C6 E6 G6 (1047, 1319, 1568 Hz; the last longer), then again after a pause: 1.6 s.
rw="$(note 0 0.12 1047)+$(note 0.15 0.12 1319)+$(note 0.30 0.22 1568)+$(note 0.85 0.12 1047)+$(note 1.00 0.12 1319)+$(note 1.15 0.22 1568)"
ogg request_waiting.ogg 1.6 0.8 "$rw"

# Six quick pulses alternating F6 and B5 (1397, 988 Hz; 0.1 s each, 0.05 s apart), twice: 1.8 s.
ic=""
for start in 0 0.15 0.30 0.45 0.60 0.75; do
  hz=$(awk -v s="$start" 'BEGIN { print (int(s / 0.15 + 0.5) % 2 == 0) ? 1397 : 988 }')
  ic+="${ic:++}$(note "$start" 0.1 "$hz")"
  ic+="+$(note "$(awk -v s="$start" 'BEGIN { print s + 0.95 }')" 0.1 "$hz")"
done
ogg issue_critical.ogg 1.8 0.72 "$ic"
