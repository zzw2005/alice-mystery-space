#!/bin/bash
# Convert pet frame sequences to GIF (binary transparency survives every renderer).
set -u
BASE=~/workspace/butler-build
OUT=~/workspace/your_files/space-real/anim
mkdir -p "$OUT"
A60=$BASE/AliceButler/assets/anim60
AFLAT=$BASE/AliceButler/assets/anim-flat
SPR=$BASE/sprite-frames

build() { # name srcdir inframerate fps(0=keep)
  local name=$1 dir=$2 infps=$3 fps=$4
  local vf="scale=300:-1:flags=lanczos"
  [ "$fps" != "0" ] && vf="fps=$fps,$vf"
  vf="$vf,split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128:dither=bayer:bayer_scale=3"
  ffmpeg -y -v error -framerate "$infps" -pattern_type glob -i "$dir/*.png" \
    -filter_complex "$vf" -loop 0 "$OUT/act-$name.gif" \
    && echo "OK $name $(stat -c%s "$OUT/act-$name.gif") bytes" || echo "FAIL $name"
}

for n in breathe walk doze sit wave celebrate water fish wiggle dragdangle; do
  build $n $A60/$n 60 15
done
for n in clickhappy clickshy clicktsun; do build $n $AFLAT/$n 16 0; done
for n in yawn startled wakeup; do build $n $AFLAT/$n 12 0; done
build love $SPR/love 10 0
echo DONE
