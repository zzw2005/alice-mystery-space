#!/bin/bash
# Rebuild space animated WebPs with ffmpeg libwebp_anim (spec-clean alpha).
set -u
BASE=~/workspace/butler-build
OUT=~/workspace/your_files/space-real/anim
mkdir -p "$OUT"
A60=$BASE/AliceButler/assets/anim60
AFLAT=$BASE/AliceButler/assets/anim-flat
SPR=$BASE/sprite-frames

build() { # name srcdir inframerate fpsfilter
  local name=$1 dir=$2 infps=$3 fps=$4
  local vf="scale=320:-2:flags=lanczos"
  [ "$fps" != "0" ] && vf="fps=$fps,$vf"
  ffmpeg -y -v error -framerate "$infps" -pattern_type glob -i "$dir/*.png" \
    -vf "$vf" -c:v libwebp_anim -loop 0 -q:v 65 -preset default -an \
    "$OUT/act-$name.webp" && echo "OK $name $(stat -c%s "$OUT/act-$name.webp") bytes" || echo "FAIL $name"
}

build breathe   $A60/breathe   60 30
for n in walk doze sit wave celebrate water fish wiggle dragdangle; do
  build $n $A60/$n 60 15
done
for n in clickhappy clickshy clicktsun; do build $n $AFLAT/$n 16 0; done
for n in yawn startled wakeup; do build $n $AFLAT/$n 12 0; done
build love $SPR/love 10 0
echo DONE
